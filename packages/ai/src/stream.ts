import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3, LanguageModelV3Message, LanguageModelV3Middleware } from "@ai-sdk/provider";
import { NamedError } from "@jayden/jai-utils";
import { streamText, wrapLanguageModel } from "ai";
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
	const wrappedOpts = ProviderTransform.providerOptions(modelInfo, providerOpts);

	const llmModel = wrapLanguageModel({
		model: resolveModel(config),
		middleware: buildMiddleware(modelInfo),
	});

	const tools = capabilities.toolCall && input.tools?.length ? convertTools(input.tools) : undefined;

	const temp = ProviderTransform.temperature(modelInfo);
	const tp = ProviderTransform.topP(modelInfo);

	const result = streamText({
		model: llmModel,
		system: input.systemPrompt,
		messages: convertMessages(normalizeMessages(input.messages), capabilities),
		tools,
		abortSignal: input.abortSignal,
		maxRetries: input.maxRetries ?? 2,
		maxOutputTokens: ProviderTransform.maxOutputTokens(modelInfo),
		...(temp !== undefined && { temperature: temp }),
		...(tp !== undefined && { topP: tp }),
		providerOptions: wrappedOpts,
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
				const error =
					chunk.error instanceof NamedError
						? chunk.error
						: new NamedError.Unknown({
								message: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
							});
				yield { type: "error", error };
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
			}

			result.push(msg);
		} else if (msg.role === "tool_result") {
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
								data: URL;
								mediaType: string;
						  }
					)[] => {
						if (block.type === "text") {
							return [{ type: "text" as const, text: block.text }];
						}
						if (!capabilities.input.image) return [];
						return [
							{
								type: "file" as const,
								data: new URL(block.url),
								mediaType: block.mimeType,
							},
						];
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

function convertTools(
	tools: ToolDefinition[],
): Record<string, { description: string; inputSchema: ToolDefinition["parameters"] }> {
	return Object.fromEntries(tools.map((t) => [t.name, { description: t.description, inputSchema: t.parameters }]));
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
