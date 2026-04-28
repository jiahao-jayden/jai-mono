import { inspect } from "node:util";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONSchema7, LanguageModelV3, LanguageModelV3Message, LanguageModelV3Middleware } from "@ai-sdk/provider";
import { NamedError } from "@jayden/jai-utils";
import { jsonSchema, streamText, wrapLanguageModel } from "ai";
import z from "zod";
import { resolveModelInfo } from "./models.js";
import type {
	AssistantMessage,
	Message,
	ModelCapabilities,
	ProviderConfig,
	ResolvedModel,
	StreamEvent,
	StreamMessageInput,
	ToolCall,
	ToolDefinition,
	Usage,
} from "./types.js";
import { ProviderTransform } from "./utils.js";

// ── 入口 ──────────────────────────────────────────────────────

export async function* streamMessage(input: StreamMessageInput): AsyncGenerator<StreamEvent> {
	const modelInfo: ResolvedModel =
		typeof input.model === "string"
			? resolveModelInfo(input.model, {
					apiKey: input.apiKey,
					baseURL: input.baseURL,
				})
			: toResolvedModel(input.model);

	const { config, capabilities } = modelInfo;

	const providerOpts = ProviderTransform.options({
		model: modelInfo,
		sessionId: input.sessionId ?? crypto.randomUUID(),
	});

	if (input.reasoningEffort) {
		const vars = ProviderTransform.variants(modelInfo);
		const effortOpts = vars[input.reasoningEffort];
		if (effortOpts) {
			Object.assign(providerOpts, effortOpts);
		}
	}

	const wrappedOpts = ProviderTransform.providerOptions(modelInfo, providerOpts);

	const llmModel = wrapLanguageModel({
		model: resolveModel(config),
		middleware: buildMiddleware(modelInfo),
	});

	const tools = capabilities.toolCall && input.tools?.length ? convertTools(input.tools) : undefined;

	const temp = ProviderTransform.temperature(modelInfo);
	const tp = ProviderTransform.topP(modelInfo);

	const normalized = normalizeMessages(input.messages);
	const convertedMessages = convertMessages(normalized, capabilities);

	let rawError: unknown;
	const result = streamText({
		model: llmModel,
		system: input.systemPrompt,
		messages: convertedMessages,
		tools,
		abortSignal: input.abortSignal,
		maxRetries: input.maxRetries ?? 2,
		maxOutputTokens: ProviderTransform.maxOutputTokens(modelInfo),
		...(temp !== undefined && { temperature: temp }),
		...(tp !== undefined && { topP: tp }),
		providerOptions: wrappedOpts,
		onError({ error }) {
			rawError = error;
			console.error("[ai] provider error:", inspect(error, { depth: 5, getters: true }));
		},
	});

	yield { type: "message_start" };

	const accumulated: AssistantMessage = {
		role: "assistant",
		content: [],
		stopReason: "stop",
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		timestamp: Date.now(),
	};

	for await (const chunk of result.fullStream) {
		switch (chunk.type) {
			case "text-delta": {
				const last = accumulated.content.at(-1);
				if (last?.type === "text") {
					last.text += chunk.text;
				} else {
					accumulated.content.push({ type: "text", text: chunk.text });
				}
				yield { type: "text_delta", text: chunk.text };
				break;
			}

			case "reasoning-delta": {
				const last = accumulated.content.at(-1);
				if (last?.type === "thinking") {
					last.text += chunk.text;
				} else {
					accumulated.content.push({ type: "thinking", text: chunk.text });
				}
				yield { type: "reasoning_delta", text: chunk.text };
				break;
			}

			case "tool-call": {
				const toolCall: ToolCall = {
					type: "tool_call",
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					input: chunk.input,
				};
				accumulated.content.push(toolCall);
				yield {
					type: "tool_call",
					toolCallId: chunk.toolCallId,
					toolName: chunk.toolName,
					input: chunk.input,
				};
				break;
			}

			case "finish-step": {
				const usage = convertUsage(chunk.usage);
				yield {
					type: "step_finish",
					finishReason: chunk.finishReason,
					usage,
				};
				break;
			}

			case "finish": {
				accumulated.stopReason = convertStopReason(chunk.finishReason);
				accumulated.usage = convertUsage(chunk.totalUsage);
				break;
			}

			case "error": {
				const original = rawError ?? chunk.error;
				const message = formatProviderError(original);
				yield { type: "error", error: new Error(message, { cause: original }) };
				return;
			}
		}
	}

	yield { type: "message_end", message: accumulated };
}

// ── resolveModel ──────────────────────────────────────────────

function resolveModel(config: ProviderConfig): LanguageModelV3 {
	const { name, provider, model, apiKey, baseURL } = config;

	switch (provider) {
		case "anthropic": {
			const p = createAnthropic({ apiKey, baseURL });
			return p(model);
		}
		case "openai": {
			const p = createOpenAI({ apiKey, baseURL });
			return p(model);
		}
		case "google": {
			const p = createGoogleGenerativeAI({ apiKey, baseURL });
			return p(model);
		}
		case "openai-compatible": {
			if (!baseURL) {
				throw new BaseURLRequiredError("baseURL is required for openai-compatible providers");
			}
			const p = createOpenAICompatible({
				apiKey,
				name: name ?? "openai-compatible",
				baseURL,
			});
			return p(model);
		}
		default: {
			const _exhaustive: never = provider;
			throw new NamedError.Unknown({
				message: `Unknown provider: ${_exhaustive}`,
			});
		}
	}
}

// ── buildMiddleware ───────────────────────────────────────────
// Delegates to ProviderTransform.message() for comprehensive
// provider-specific normalization and prompt caching.

function buildMiddleware(model: ResolvedModel): LanguageModelV3Middleware {
	return {
		specificationVersion: "v3",
		transformParams: async ({ params }) => {
			params.prompt = ProviderTransform.message(params.prompt as any[], model, {}) as typeof params.prompt;
			return params;
		},
	};
}

// ── normalizeMessages ─────────────────────────────────────────

function normalizeMessages(messages: Message[]): Message[] {
	const result: Message[] = [];
	let pendingToolCalls: ToolCall[] = [];
	const seenToolResultIds = new Set<string>();
	// 全程累积所有出现过的 assistant tool_call id；用于判断 tool_result 是否「孤儿」
	// （前面没有任何 assistant 发起过对应的 tool_call）。
	const knownToolCallIds = new Set<string>();

	function flushOrphans() {
		for (const tc of pendingToolCalls) {
			if (!seenToolResultIds.has(tc.toolCallId)) {
				result.push({
					role: "tool_result",
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
					content: [{ type: "text", text: "No result provided" }],
					isError: true,
					timestamp: Date.now(),
				});
			}
		}
		pendingToolCalls = [];
		seenToolResultIds.clear();
	}

	for (const msg of messages) {
		if (msg.role === "assistant") {
			flushOrphans();

			if (msg.stopReason === "error" || msg.stopReason === "aborted") {
				continue;
			}

			const toolCalls = msg.content.filter((b): b is ToolCall => b.type === "tool_call");
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				for (const tc of toolCalls) knownToolCallIds.add(tc.toolCallId);
			}

			result.push(msg);
		} else if (msg.role === "tool_result") {
			// 兜底：如果上下文里没有任何 assistant 发起过这个 tool_call（典型场景：
			// 历史 jsonl 因为旧版 race condition 导致 parentId 链丢失了 assistant
			// tool_calls 那条 entry），就丢弃这条孤儿 tool_result —— 否则会触发
			// provider 报 "tool result's tool id not found"。
			if (!knownToolCallIds.has(msg.toolCallId)) {
				console.warn(
					`[ai] dropping orphan tool_result (toolCallId=${msg.toolCallId}, toolName=${msg.toolName}) ` +
						`— no preceding assistant tool_call found in history`,
				);
				continue;
			}
			seenToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else {
			flushOrphans();
			result.push(msg);
		}
	}

	flushOrphans();
	return result;
}

// ── convertMessages ───────────────────────────────────────────

function convertMessages(messages: Message[], capabilities: ModelCapabilities): LanguageModelV3Message[] {
	const result: LanguageModelV3Message[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			result.push({
				role: "user",
				content: msg.content.flatMap(
					(
						block,
					): (
						| { type: "text"; text: string }
						| {
								type: "file";
								data: URL | Buffer;
								mediaType: string;
						  }
					)[] => {
						if (block.type === "text") {
							return [{ type: "text" as const, text: block.text }];
						}
						if (block.type === "image") {
							if (!capabilities.input.image) return [];
							if (block.data) {
								return [
									{
										type: "file" as const,
										data: Buffer.from(block.data, "base64"),
										mediaType: block.mimeType,
									},
								];
							}
							if (block.url) {
								return [
									{
										type: "file" as const,
										data: new URL(block.url),
										mediaType: block.mimeType,
									},
								];
							}
							return [];
						}
						if (block.type === "file") {
							return [
								{
									type: "file" as const,
									data: Buffer.from(block.data, "base64"),
									mediaType: block.mimeType,
								},
							];
						}
						return [];
					},
				),
			});
		} else if (msg.role === "assistant") {
			result.push({
				role: "assistant",
				content: msg.content.flatMap(
					(
						block,
					): (
						| { type: "text"; text: string }
						| {
								type: "tool-call";
								toolCallId: string;
								toolName: string;
								input: unknown;
						  }
					)[] => {
						if (block.type === "text") {
							return [{ type: "text" as const, text: block.text }];
						}
						if (block.type === "thinking") {
							if (!capabilities.reasoning) {
								return [{ type: "text" as const, text: block.text }];
							}
							return [];
						}
						return [
							{
								type: "tool-call" as const,
								toolCallId: block.toolCallId,
								toolName: block.toolName,
								input: block.input,
							},
						];
					},
				),
			});
		} else if (msg.role === "tool_result") {
			result.push({
				role: "tool",
				content: [
					{
						type: "tool-result" as const,
						toolCallId: msg.toolCallId,
						toolName: msg.toolName,
						output: {
							type: "text" as const,
							value: msg.content
								.filter((b) => b.type === "text")
								.map((b) => b.text)
								.join("\n"),
						},
					},
				],
			});
		}
	}

	return result;
}

// ── convertTools ──────────────────────────────────────────────

function convertTools(tools: ToolDefinition[]) {
	return Object.fromEntries(
		tools.map((t) => [
			t.name,
			{
				description: t.description,
				inputSchema: isZodSchema(t.parameters) ? t.parameters : jsonSchema(t.parameters as JSONSchema7),
			},
		]),
	);
}

function isZodSchema(value: unknown): value is z.ZodType {
	// Zod schemas have a `_def` object; plain JSON Schema does not.
	return (
		typeof value === "object" &&
		value !== null &&
		"_def" in value &&
		typeof (value as { _def: unknown })._def === "object"
	);
}

// ── toResolvedModel ───────────────────────────────────────────
// Adapts a manually-constructed ModelInfo to a ResolvedModel
// for callers that don't use the registry.

function toResolvedModel(info: Exclude<StreamMessageInput["model"], string>): ResolvedModel {
	return {
		...info,
		id: `${info.config.provider}/${info.config.model}`,
		providerId: info.config.name ?? info.config.provider,
		npm: providerToNpm(info.config.provider),
		apiModelId: info.config.model,
	};
}

function providerToNpm(provider: ProviderConfig["provider"]): string {
	switch (provider) {
		case "anthropic":
			return "@ai-sdk/anthropic";
		case "openai":
			return "@ai-sdk/openai";
		case "google":
			return "@ai-sdk/google";
		case "openai-compatible":
			return "@ai-sdk/openai-compatible";
	}
}

// ── helpers ───────────────────────────────────────────────────

function convertStopReason(reason: string): AssistantMessage["stopReason"] {
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "tool-calls":
			return "tool_calls";
		case "error":
			return "error";
		default:
			return "stop";
	}
}

function convertUsage(usage: {
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	inputTokenDetails?: {
		cacheReadTokens?: number | undefined;
		cacheWriteTokens?: number | undefined;
	};
}): Usage {
	return {
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
		cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
	};
}

// ── Errors ────────────────────────────────────────────────────

const BaseURLRequiredError = NamedError.create("BaseURLRequiredError", z.string());

function formatProviderError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);

	const e = error as Error & {
		statusCode?: number;
		url?: string;
		responseBody?: string;
		data?: unknown;
	};

	const parts: string[] = [];
	if (typeof e.statusCode === "number") parts.push(`HTTP ${e.statusCode}`);
	if (e.message) parts.push(e.message);

	const detail = extractProviderDetail(e.responseBody, e.data);
	if (detail) parts.push(detail);

	if (e.url) parts.push(`(${redactUrl(e.url)})`);

	return parts.join(" — ") || e.message || "Unknown provider error";
}

function extractProviderDetail(responseBody: unknown, data: unknown): string | undefined {
	const candidates: unknown[] = [];
	if (typeof responseBody === "string" && responseBody.length > 0) {
		try {
			candidates.push(JSON.parse(responseBody));
		} catch {
			return responseBody.slice(0, 500);
		}
	}
	if (data !== undefined) candidates.push(data);

	for (const c of candidates) {
		if (!c || typeof c !== "object") continue;
		const obj = c as Record<string, unknown>;
		const err = (obj.error ?? obj) as Record<string, unknown> | undefined;
		if (err && typeof err === "object") {
			const msg = typeof err.message === "string" ? err.message : undefined;
			const code = typeof err.code === "string" ? err.code : undefined;
			const type = typeof err.type === "string" ? err.type : undefined;
			const tag = [type, code].filter(Boolean).join("/");
			if (msg) return tag ? `${tag}: ${msg}` : msg;
		}
	}
	return undefined;
}

function redactUrl(url: string): string {
	try {
		const u = new URL(url);
		return `${u.origin}${u.pathname}`;
	} catch {
		return url;
	}
}
