import type { JSONSchema7, LanguageModelV3Message } from "@ai-sdk/provider";
import type { ResolvedModel } from "./types.js";

type Msg = LanguageModelV3Message;

type Modality = "text" | "image" | "audio" | "video" | "pdf";

function mimeToModality(mime: string): Modality | undefined {
	if (mime.startsWith("image/")) return "image";
	if (mime.startsWith("audio/")) return "audio";
	if (mime.startsWith("video/")) return "video";
	if (mime === "application/pdf") return "pdf";
	return undefined;
}

function mergeDeep(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		const tv = target[key];
		const sv = source[key];
		if (
			typeof tv === "object" &&
			tv !== null &&
			!Array.isArray(tv) &&
			typeof sv === "object" &&
			sv !== null &&
			!Array.isArray(sv)
		) {
			result[key] = mergeDeep(tv, sv);
		} else {
			result[key] = sv;
		}
	}
	return result;
}

function unique<T>(arr: T[]): T[] {
	return Array.from(new Set(arr));
}

export namespace ProviderTransform {
	export const OUTPUT_TOKEN_MAX =
		(() => {
			const v = process.env.JAI_OUTPUT_TOKEN_MAX;
			if (!v) return undefined;
			const n = Number(v);
			return Number.isInteger(n) && n > 0 ? n : undefined;
		})() ?? 32_000;

	function sdkKey(npm: string): string | undefined {
		switch (npm) {
			case "@ai-sdk/github-copilot":
				return "copilot";
			case "@ai-sdk/azure":
				return "azure";
			case "@ai-sdk/openai":
				return "openai";
			case "@ai-sdk/amazon-bedrock":
				return "bedrock";
			case "@ai-sdk/anthropic":
			case "@ai-sdk/google-vertex/anthropic":
				return "anthropic";
			case "@ai-sdk/google-vertex":
				return "vertex";
			case "@ai-sdk/google":
				return "google";
			case "@ai-sdk/gateway":
				return "gateway";
			case "@openrouter/ai-sdk-provider":
				return "openrouter";
		}
		return undefined;
	}

	function normalizeMessages(msgs: Msg[], model: ResolvedModel, _options: Record<string, unknown>): Msg[] {
		if (model.npm === "@ai-sdk/anthropic" || model.npm === "@ai-sdk/amazon-bedrock") {
			msgs = msgs
				.map((msg) => {
					if (typeof msg.content === "string") {
						if (msg.content === "") return undefined;
						return msg;
					}
					if (!Array.isArray(msg.content)) return msg;
					const filtered = msg.content.filter((part) => {
						if (part.type === "text" || part.type === "reasoning") {
							return part.text !== "";
						}
						return true;
					});
					if (filtered.length === 0) return undefined;
					return { ...msg, content: filtered };
				})
				.filter((msg): msg is Msg => msg !== undefined && msg.content !== "");
		}

		if (model.apiModelId.includes("claude")) {
			const scrub = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
			return msgs.map((msg) => {
				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					return {
						...msg,
						content: msg.content.map((part) => {
							if (part.type === "tool-call" || part.type === "tool-result") {
								return { ...part, toolCallId: scrub(part.toolCallId) };
							}
							return part;
						}),
					};
				}
				if (msg.role === "tool" && Array.isArray(msg.content)) {
					return {
						...msg,
						content: msg.content.map((part) => {
							if (part.type === "tool-result") {
								return { ...part, toolCallId: scrub(part.toolCallId) };
							}
							return part;
						}),
					};
				}
				return msg;
			});
		}

		if (
			model.providerId === "mistral" ||
			model.apiModelId.toLowerCase().includes("mistral") ||
			model.apiModelId.toLowerCase().includes("devstral")
		) {
			const scrub = (id: string) => {
				return id
					.replace(/[^a-zA-Z0-9]/g, "")
					.substring(0, 9)
					.padEnd(9, "0");
			};
			const result: Msg[] = [];
			for (let i = 0; i < msgs.length; i++) {
				const msg = msgs[i];
				const nextMsg = msgs[i + 1];

				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					msg.content = msg.content.map((part) => {
						if (part.type === "tool-call" || part.type === "tool-result") {
							return { ...part, toolCallId: scrub(part.toolCallId) };
						}
						return part;
					});
				}
				if (msg.role === "tool" && Array.isArray(msg.content)) {
					msg.content = msg.content.map((part) => {
						if (part.type === "tool-result") {
							return { ...part, toolCallId: scrub(part.toolCallId) };
						}
						return part;
					});
				}
				result.push(msg);

				if (msg.role === "tool" && nextMsg?.role === "user") {
					result.push({
						role: "assistant",
						content: [{ type: "text", text: "Done." }],
					});
				}
			}
			return result;
		}

		if (typeof model.interleaved === "object" && model.interleaved?.field) {
			const field = model.interleaved.field;
			return msgs.map((msg) => {
				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning");
					const reasoningText = reasoningParts.map((part: any) => part.text).join("");
					const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning");

					if (reasoningText) {
						return {
							...msg,
							content: filteredContent,
							providerOptions: {
								...msg.providerOptions,
								openaiCompatible: {
									...(msg.providerOptions as any)?.openaiCompatible,
									[field]: reasoningText,
								},
							},
						};
					}

					return { ...msg, content: filteredContent };
				}
				return msg;
			});
		}

		return msgs;
	}

	function applyCaching(msgs: Msg[], _model: ResolvedModel): Msg[] {
		const system = msgs.filter((msg) => msg.role === "system").slice(0, 2);
		const final = msgs.filter((msg) => msg.role !== "system").slice(-2);

		const providerOptions = {
			anthropic: { cacheControl: { type: "ephemeral" } },
			openrouter: { cacheControl: { type: "ephemeral" } },
			bedrock: { cachePoint: { type: "default" } },
			openaiCompatible: { cache_control: { type: "ephemeral" } },
			copilot: { copilot_cache_control: { type: "ephemeral" } },
		};

		for (const msg of unique([...system, ...final])) {
			const useMessageLevelOptions =
				_model.providerId === "anthropic" ||
				_model.providerId.includes("bedrock") ||
				_model.npm === "@ai-sdk/amazon-bedrock";
			const shouldUseContentOptions =
				!useMessageLevelOptions && Array.isArray(msg.content) && msg.content.length > 0;

			if (shouldUseContentOptions) {
				const lastContent = msg.content[msg.content.length - 1] as any;
				if (
					lastContent &&
					typeof lastContent === "object" &&
					lastContent.type !== "tool-approval-request" &&
					lastContent.type !== "tool-approval-response"
				) {
					lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions);
					continue;
				}
			}

			msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions);
		}

		return msgs;
	}

	function unsupportedParts(msgs: Msg[], model: ResolvedModel): Msg[] {
		return msgs.map((msg) => {
			if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;

			const filtered = (msg.content as any[]).map((part: any) => {
				if (part.type !== "file" && part.type !== "image") return part;

				if (part.type === "image") {
					const imageStr = part.image.toString();
					if (imageStr.startsWith("data:")) {
						const match = imageStr.match(/^data:([^;]+);base64,(.*)$/);
						if (match && (!match[2] || match[2].length === 0)) {
							return {
								type: "text" as const,
								text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
							};
						}
					}
				}

				const mime =
					part.type === "image" ? part.image.toString().split(";")[0].replace("data:", "") : part.mediaType;
				const filename = part.type === "file" ? part.filename : undefined;
				const modality = mimeToModality(mime);
				if (!modality) return part;
				if (model.capabilities.input[modality]) return part;

				const name = filename ? `"${filename}"` : modality;
				return {
					type: "text" as const,
					text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
				};
			});

			return { ...msg, content: filtered } as typeof msg;
		});
	}

	export function message(msgs: Msg[], model: ResolvedModel, options: Record<string, unknown>) {
		msgs = unsupportedParts(msgs, model);
		msgs = normalizeMessages(msgs, model, options);

		if (
			(model.providerId === "anthropic" ||
				model.providerId === "google-vertex-anthropic" ||
				model.apiModelId.includes("anthropic") ||
				model.apiModelId.includes("claude") ||
				model.id.includes("anthropic") ||
				model.id.includes("claude") ||
				model.npm === "@ai-sdk/anthropic") &&
			model.npm !== "@ai-sdk/gateway"
		) {
			msgs = applyCaching(msgs, model);
		}

		const key = sdkKey(model.npm);
		if (key && key !== model.providerId) {
			const remap = (opts: Record<string, any> | undefined) => {
				if (!opts) return opts;
				if (!(model.providerId in opts)) return opts;
				const result = { ...opts };
				result[key] = result[model.providerId];
				delete result[model.providerId];
				return result;
			};

			msgs = msgs.map((msg) => {
				if (!Array.isArray(msg.content)) return { ...msg, providerOptions: remap(msg.providerOptions) };
				return {
					...msg,
					providerOptions: remap(msg.providerOptions),
					content: (msg.content as any[]).map((part: any) => {
						if (part.type === "tool-approval-request" || part.type === "tool-approval-response") {
							return { ...part };
						}
						return {
							...part,
							providerOptions: remap(part.providerOptions),
						};
					}),
				} as typeof msg;
			});
		}

		return msgs;
	}

	export function temperature(model: ResolvedModel) {
		const id = model.id.toLowerCase();
		if (id.includes("qwen")) return 0.55;
		if (id.includes("claude")) return undefined;
		if (id.includes("gemini")) return 1.0;
		if (id.includes("glm-4.6")) return 1.0;
		if (id.includes("glm-4.7")) return 1.0;
		if (id.includes("minimax-m2")) return 1.0;
		if (id.includes("kimi-k2")) {
			if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
				return 1.0;
			}
			return 0.6;
		}
		return undefined;
	}

	export function topP(model: ResolvedModel) {
		const id = model.id.toLowerCase();
		if (id.includes("qwen")) return 1;
		if (["minimax-m2", "gemini", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) => id.includes(s))) {
			return 0.95;
		}
		return undefined;
	}

	export function topK(model: ResolvedModel) {
		const id = model.id.toLowerCase();
		if (id.includes("minimax-m2")) {
			if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40;
			return 20;
		}
		if (id.includes("gemini")) return 64;
		return undefined;
	}

	const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"];
	const OPENAI_EFFORTS = ["none", "minimal", ...WIDELY_SUPPORTED_EFFORTS, "xhigh"];

	export function variants(model: ResolvedModel): Record<string, Record<string, any>> {
		if (!model.capabilities.reasoning) return {};

		const id = model.id.toLowerCase();
		const isAnthropicAdaptive = ["opus-4-6", "opus-4.6", "sonnet-4-6", "sonnet-4.6"].some((v) =>
			model.apiModelId.includes(v),
		);
		const adaptiveEfforts = ["low", "medium", "high", "max"];

		if (
			id.includes("deepseek") ||
			id.includes("minimax") ||
			id.includes("glm") ||
			id.includes("mistral") ||
			id.includes("kimi") ||
			id.includes("k2p5")
		)
			return {};

		if (id.includes("grok") && id.includes("grok-3-mini")) {
			if (model.npm === "@openrouter/ai-sdk-provider") {
				return {
					low: { reasoning: { effort: "low" } },
					high: { reasoning: { effort: "high" } },
				};
			}
			return {
				low: { reasoningEffort: "low" },
				high: { reasoningEffort: "high" },
			};
		}
		if (id.includes("grok")) return {};

		switch (model.npm) {
			case "@openrouter/ai-sdk-provider":
				if (!model.id.includes("gpt") && !model.id.includes("gemini-3") && !model.id.includes("claude")) return {};
				return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]));

			case "@ai-sdk/gateway":
				if (model.id.includes("anthropic")) {
					if (isAnthropicAdaptive) {
						return Object.fromEntries(
							adaptiveEfforts.map((effort) => [effort, { thinking: { type: "adaptive" }, effort }]),
						);
					}
					return {
						high: { thinking: { type: "enabled", budgetTokens: 16000 } },
						max: { thinking: { type: "enabled", budgetTokens: 31999 } },
					};
				}
				if (model.id.includes("google")) {
					if (id.includes("2.5")) {
						return {
							high: {
								thinkingConfig: {
									includeThoughts: true,
									thinkingBudget: 16000,
								},
							},
							max: {
								thinkingConfig: {
									includeThoughts: true,
									thinkingBudget: 24576,
								},
							},
						};
					}
					return Object.fromEntries(
						["low", "high"].map((effort) => [effort, { includeThoughts: true, thinkingLevel: effort }]),
					);
				}
				return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]));

			case "@ai-sdk/github-copilot": {
				if (model.id.includes("gemini")) return {};
				if (model.id.includes("claude")) {
					return { thinking: { thinking_budget: 4000 } };
				}
				const copilotEfforts = (() => {
					if (id.includes("5.1-codex-max") || id.includes("5.2") || id.includes("5.3"))
						return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"];
					const arr = [...WIDELY_SUPPORTED_EFFORTS];
					if (id.includes("gpt-5") && (model.releaseDate ?? "") >= "2025-12-04") arr.push("xhigh");
					return arr;
				})();
				return Object.fromEntries(
					copilotEfforts.map((effort) => [
						effort,
						{
							reasoningEffort: effort,
							reasoningSummary: "auto",
							include: ["reasoning.encrypted_content"],
						},
					]),
				);
			}

			case "@ai-sdk/cerebras":
			case "@ai-sdk/togetherai":
			case "@ai-sdk/xai":
			case "@ai-sdk/deepinfra":
			case "venice-ai-sdk-provider":
			case "@ai-sdk/openai-compatible":
				return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]));

			case "@ai-sdk/azure": {
				if (id === "o1-mini") return {};
				const azureEfforts = ["low", "medium", "high"];
				if (id.includes("gpt-5-") || id === "gpt-5") {
					azureEfforts.unshift("minimal");
				}
				return Object.fromEntries(
					azureEfforts.map((effort) => [
						effort,
						{
							reasoningEffort: effort,
							reasoningSummary: "auto",
							include: ["reasoning.encrypted_content"],
						},
					]),
				);
			}

			case "@ai-sdk/openai": {
				if (id === "gpt-5-pro") return {};
				const openaiEfforts = (() => {
					if (id.includes("codex")) {
						if (id.includes("5.2") || id.includes("5.3")) return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"];
						return WIDELY_SUPPORTED_EFFORTS;
					}
					const arr = [...WIDELY_SUPPORTED_EFFORTS];
					if (id.includes("gpt-5-") || id === "gpt-5") {
						arr.unshift("minimal");
					}
					if ((model.releaseDate ?? "") >= "2025-11-13") {
						arr.unshift("none");
					}
					if ((model.releaseDate ?? "") >= "2025-12-04") {
						arr.push("xhigh");
					}
					return arr;
				})();
				return Object.fromEntries(
					openaiEfforts.map((effort) => [
						effort,
						{
							reasoningEffort: effort,
							reasoningSummary: "auto",
							include: ["reasoning.encrypted_content"],
						},
					]),
				);
			}

			case "@ai-sdk/anthropic":
			case "@ai-sdk/google-vertex/anthropic":
				if (isAnthropicAdaptive) {
					return Object.fromEntries(
						adaptiveEfforts.map((effort) => [effort, { thinking: { type: "adaptive" }, effort }]),
					);
				}
				return {
					high: {
						thinking: {
							type: "enabled",
							budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)),
						},
					},
					max: {
						thinking: {
							type: "enabled",
							budgetTokens: Math.min(31_999, model.limit.output - 1),
						},
					},
				};

			case "@ai-sdk/amazon-bedrock":
				if (isAnthropicAdaptive) {
					return Object.fromEntries(
						adaptiveEfforts.map((effort) => [
							effort,
							{
								reasoningConfig: {
									type: "adaptive",
									maxReasoningEffort: effort,
								},
							},
						]),
					);
				}
				if (model.apiModelId.includes("anthropic")) {
					return {
						high: {
							reasoningConfig: {
								type: "enabled",
								budgetTokens: 16000,
							},
						},
						max: {
							reasoningConfig: {
								type: "enabled",
								budgetTokens: 31999,
							},
						},
					};
				}
				return Object.fromEntries(
					WIDELY_SUPPORTED_EFFORTS.map((effort) => [
						effort,
						{
							reasoningConfig: {
								type: "enabled",
								maxReasoningEffort: effort,
							},
						},
					]),
				);

			case "@ai-sdk/google-vertex":
			case "@ai-sdk/google": {
				if (id.includes("2.5")) {
					return {
						high: {
							thinkingConfig: {
								includeThoughts: true,
								thinkingBudget: 16000,
							},
						},
						max: {
							thinkingConfig: {
								includeThoughts: true,
								thinkingBudget: 24576,
							},
						},
					};
				}
				let levels = ["low", "high"];
				if (id.includes("3.1")) {
					levels = ["low", "medium", "high"];
				}
				return Object.fromEntries(
					levels.map((effort) => [
						effort,
						{
							thinkingConfig: {
								includeThoughts: true,
								thinkingLevel: effort,
							},
						},
					]),
				);
			}

			case "@ai-sdk/mistral":
			case "@ai-sdk/cohere":
			case "@ai-sdk/perplexity":
				return {};

			case "@ai-sdk/groq": {
				const groqEffort = ["none", ...WIDELY_SUPPORTED_EFFORTS];
				return Object.fromEntries(groqEffort.map((effort) => [effort, { reasoningEffort: effort }]));
			}

			case "@jerome-benoit/sap-ai-provider-v2":
				if (model.apiModelId.includes("anthropic")) {
					if (isAnthropicAdaptive) {
						return Object.fromEntries(
							adaptiveEfforts.map((effort) => [effort, { thinking: { type: "adaptive" }, effort }]),
						);
					}
					return {
						high: {
							thinking: { type: "enabled", budgetTokens: 16000 },
						},
						max: {
							thinking: { type: "enabled", budgetTokens: 31999 },
						},
					};
				}
				if (model.apiModelId.includes("gemini") && id.includes("2.5")) {
					return {
						high: {
							thinkingConfig: {
								includeThoughts: true,
								thinkingBudget: 16000,
							},
						},
						max: {
							thinkingConfig: {
								includeThoughts: true,
								thinkingBudget: 24576,
							},
						},
					};
				}
				if (model.apiModelId.includes("gpt") || /\bo[1-9]/.test(model.apiModelId)) {
					return Object.fromEntries(
						WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]),
					);
				}
				return {};
		}
		return {};
	}

	export function options(input: {
		model: ResolvedModel;
		sessionId: string;
		providerOptions?: Record<string, any>;
	}): Record<string, any> {
		const result: Record<string, any> = {};

		if (
			input.model.providerId === "openai" ||
			input.model.npm === "@ai-sdk/openai" ||
			input.model.npm === "@ai-sdk/github-copilot"
		) {
			result.store = false;
		}

		if (input.model.npm === "@openrouter/ai-sdk-provider") {
			result.usage = { include: true };
			if (input.model.apiModelId.includes("gemini-3")) {
				result.reasoning = { effort: "high" };
			}
		}

		if (
			input.model.providerId === "baseten" ||
			(input.model.providerId === "opencode" && ["kimi-k2-thinking", "glm-4.6"].includes(input.model.apiModelId))
		) {
			result.chat_template_args = { enable_thinking: true };
		}

		if (["zai", "zhipuai"].includes(input.model.providerId) && input.model.npm === "@ai-sdk/openai-compatible") {
			result.thinking = { type: "enabled", clear_thinking: false };
		}

		if (input.model.providerId === "openai" || input.providerOptions?.setCacheKey) {
			result.promptCacheKey = input.sessionId;
		}

		if (input.model.npm === "@ai-sdk/google" || input.model.npm === "@ai-sdk/google-vertex") {
			if (input.model.capabilities.reasoning) {
				result.thinkingConfig = { includeThoughts: true };
				if (input.model.apiModelId.includes("gemini-3")) {
					result.thinkingConfig.thinkingLevel = "high";
				}
			}
		}

		const modelId = input.model.apiModelId.toLowerCase();
		if (
			(input.model.npm === "@ai-sdk/anthropic" || input.model.npm === "@ai-sdk/google-vertex/anthropic") &&
			(modelId.includes("k2p5") || modelId.includes("kimi-k2.5") || modelId.includes("kimi-k2p5"))
		) {
			result.thinking = {
				type: "enabled",
				budgetTokens: Math.min(16_000, Math.floor(input.model.limit.output / 2 - 1)),
			};
		}

		if (
			input.model.providerId === "alibaba-cn" &&
			input.model.capabilities.reasoning &&
			input.model.npm === "@ai-sdk/openai-compatible" &&
			!modelId.includes("kimi-k2-thinking")
		) {
			result.enable_thinking = true;
		}

		if (input.model.apiModelId.includes("gpt-5") && !input.model.apiModelId.includes("gpt-5-chat")) {
			if (!input.model.apiModelId.includes("gpt-5-pro")) {
				result.reasoningEffort = "medium";
				result.reasoningSummary = "auto";
			}
			if (
				input.model.apiModelId.includes("gpt-5.") &&
				!input.model.apiModelId.includes("codex") &&
				!input.model.apiModelId.includes("-chat") &&
				input.model.providerId !== "azure"
			) {
				result.textVerbosity = "low";
			}
			if (input.model.providerId.startsWith("opencode")) {
				result.promptCacheKey = input.sessionId;
				result.include = ["reasoning.encrypted_content"];
				result.reasoningSummary = "auto";
			}
		}

		if (input.model.providerId === "venice") {
			result.promptCacheKey = input.sessionId;
		}

		if (input.model.providerId === "openrouter") {
			result.prompt_cache_key = input.sessionId;
		}

		if (input.model.npm === "@ai-sdk/gateway") {
			result.gateway = { caching: "auto" };
		}

		return result;
	}

	export function smallOptions(model: ResolvedModel) {
		if (model.providerId === "openai" || model.npm === "@ai-sdk/openai" || model.npm === "@ai-sdk/github-copilot") {
			if (model.apiModelId.includes("gpt-5")) {
				if (model.apiModelId.includes("5.")) {
					return { store: false, reasoningEffort: "low" };
				}
				return { store: false, reasoningEffort: "minimal" };
			}
			return { store: false };
		}
		if (model.providerId === "google") {
			if (model.apiModelId.includes("gemini-3")) {
				return { thinkingConfig: { thinkingLevel: "minimal" } };
			}
			return { thinkingConfig: { thinkingBudget: 0 } };
		}
		if (model.providerId === "openrouter") {
			if (model.apiModelId.includes("google")) {
				return { reasoning: { enabled: false } };
			}
			return { reasoningEffort: "minimal" };
		}
		if (model.providerId === "venice") {
			return { veniceParameters: { disableThinking: true } };
		}
		return {};
	}

	const SLUG_OVERRIDES: Record<string, string> = {
		amazon: "bedrock",
	};

	export function providerOptions(model: ResolvedModel, opts: Record<string, any>) {
		if (model.npm === "@ai-sdk/gateway") {
			const i = model.apiModelId.indexOf("/");
			const rawSlug = i > 0 ? model.apiModelId.slice(0, i) : undefined;
			const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined;
			const gateway = opts.gateway;
			const rest = Object.fromEntries(Object.entries(opts).filter(([k]) => k !== "gateway"));
			const has = Object.keys(rest).length > 0;

			const result: Record<string, any> = {};
			if (gateway !== undefined) result.gateway = gateway;

			if (has) {
				if (slug) {
					result[slug] = rest;
				} else if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
					result.gateway = { ...gateway, ...rest };
				} else {
					result.gateway = rest;
				}
			}

			return result;
		}

		const key = sdkKey(model.npm) ?? model.providerId;
		return { [key]: opts };
	}

	export function maxOutputTokens(model: ResolvedModel): number {
		return Math.min(model.limit.output, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX;
	}

	export function schema(model: ResolvedModel, inputSchema: JSONSchema7): JSONSchema7 {
		if (model.providerId === "google" || model.apiModelId.includes("gemini")) {
			const isPlainObject = (node: unknown): node is Record<string, any> =>
				typeof node === "object" && node !== null && !Array.isArray(node);
			const hasCombiner = (node: unknown) =>
				isPlainObject(node) &&
				(Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf));
			const hasSchemaIntent = (node: unknown) => {
				if (!isPlainObject(node)) return false;
				if (hasCombiner(node)) return true;
				return [
					"type",
					"properties",
					"items",
					"prefixItems",
					"enum",
					"const",
					"$ref",
					"additionalProperties",
					"patternProperties",
					"required",
					"not",
					"if",
					"then",
					"else",
				].some((key) => key in node);
			};

			const sanitizeGemini = (obj: any): any => {
				if (obj === null || typeof obj !== "object") return obj;
				if (Array.isArray(obj)) return obj.map(sanitizeGemini);

				const result: any = {};
				for (const [key, value] of Object.entries(obj)) {
					if (key === "enum" && Array.isArray(value)) {
						result[key] = value.map((v) => String(v));
						if (result.type === "integer" || result.type === "number") {
							result.type = "string";
						}
					} else if (typeof value === "object" && value !== null) {
						result[key] = sanitizeGemini(value);
					} else {
						result[key] = value;
					}
				}

				if (result.type === "object" && result.properties && Array.isArray(result.required)) {
					result.required = result.required.filter((field: any) => field in result.properties);
				}

				if (result.type === "array" && !hasCombiner(result)) {
					if (result.items == null) result.items = {};
					if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
						result.items.type = "string";
					}
				}

				if (result.type && result.type !== "object" && !hasCombiner(result)) {
					delete result.properties;
					delete result.required;
				}

				return result;
			};

			inputSchema = sanitizeGemini(inputSchema);
		}

		return inputSchema;
	}
}
