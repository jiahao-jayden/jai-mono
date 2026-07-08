import OpenAI from "openai";
import type {
	ChatCompletionChunk,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { createAssistantMessage, runAdapterStream } from "../adapter";
import { AssistantMessageEventStream } from "../event-stream";
import type { Provider, StreamOptions } from "../provider";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	ImageContent,
	Message,
	Model,
	OpenAICompatibility,
	StopReason,
	TextContent,
	Tool,
	ToolResultMessage,
	Usage,
} from "../types";
import { zeroCost } from "../utils";

export interface OpenAIProviderConfig {
	apiKey: string;
	baseURL?: string;
}

/** 单个 tool call 的流式累积状态（OpenAI 按 delta.tool_calls[].index 分片） */
interface ToolCallState {
	contentIndex: number;
	id: string;
	name: string;
	partialArgs: string;
}

/** OpenAI 没有显式 block 生命周期事件，需要自己维护 start/end 状态 */
interface StreamState {
	textStarted: boolean;
	thinkingStarted: boolean;
	toolCalls: Map<number, ToolCallState>;
}

// 入口：Provider 类

export class OpenAIProvider implements Provider {
	readonly id = "openai-compatible";
	private readonly client: OpenAI;

	constructor(config: OpenAIProviderConfig) {
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});
	}

	stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
		const eventStream = new AssistantMessageEventStream();
		this.run(eventStream, model, context, options);
		return eventStream;
	}

	private async run(
		eventStream: AssistantMessageEventStream,
		model: Model,
		context: Context,
		options?: StreamOptions,
	): Promise<void> {
		const output = createAssistantMessage(this.id, model.id);
		const state: StreamState = {
			textStarted: false,
			thinkingStarted: false,
			toolCalls: new Map(),
		};

		await runAdapterStream(eventStream, output, options?.signal, {
			request: async () => {
				const client = options?.apiKey
					? new OpenAI({ apiKey: options.apiKey, baseURL: model.baseUrl })
					: this.client;

				const compat = (model.compatibility ?? {}) as OpenAICompatibility;
				const params = buildParams(model, context, options, compat);
				const providerOpts = options?.providerOptions?.["openai-compatible"];
				const body = providerOpts ? { ...params, ...providerOpts } : params;

				return client.chat.completions.create(
					body as ChatCompletionCreateParamsStreaming,
					options?.signal ? { signal: options.signal } : undefined,
				);
			},
			step: (chunk) => applyChunk(output, state, chunk, model.reasoning),
			// OpenAI 没有 block stop 事件，流结束时关闭所有还开着的 block
			finalize: () => finalizeBlocks(output, state),
		});
	}
}

// 入向翻译：Context → OpenAI SDK 请求体

function buildParams(
	model: Model,
	context: Context,
	options: StreamOptions | undefined,
	compat: OpenAICompatibility,
): ChatCompletionCreateParamsStreaming {
	const params: ChatCompletionCreateParamsStreaming = {
		model: model.id,
		stream: true,
		messages: convertMessages(context.messages, context.systemPrompt),
	};

	if (compat.supportsUsageInStreaming !== false) {
		params.stream_options = { include_usage: true };
	}

	const maxTokens = options?.maxTokens ?? model.maxTokens;
	if (compat.maxTokensField === "max_tokens") {
		(params as unknown as Record<string, unknown>).max_tokens = maxTokens;
	} else {
		params.max_completion_tokens = maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools.length > 0) {
		params.tools = convertTools(context.tools, compat);
	}

	return params;
}

function convertMessages(messages: Message[], systemPrompt?: string): ChatCompletionMessageParam[] {
	const params: ChatCompletionMessageParam[] = [];

	if (systemPrompt) {
		params.push({ role: "system", content: systemPrompt });
	}

	for (const msg of messages) {
		if (msg.role === "user") {
			params.push({
				role: "user",
				content: convertUserContent(msg),
			});
		} else if (msg.role === "assistant") {
			params.push(convertAssistantMessage(msg));
		} else if (msg.role === "toolResult") {
			params.push(convertToolResult(msg));
		}
	}

	return params;
}

function convertUserContent(msg: {
	content: string | (TextContent | ImageContent)[];
}): string | OpenAI.Chat.Completions.ChatCompletionContentPart[] {
	if (typeof msg.content === "string") return msg.content;

	return msg.content.map((block): OpenAI.Chat.Completions.ChatCompletionContentPart => {
		if (block.type === "text") {
			return { type: "text" as const, text: block.text };
		}
		return {
			type: "image_url" as const,
			image_url: {
				url: `data:${block.mimeType};base64,${block.image}`,
			},
		};
	});
}

function convertAssistantMessage(msg: AssistantMessage): ChatCompletionMessageParam {
	const textParts: string[] = [];
	const toolCallParams: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}> = [];

	for (const block of msg.content) {
		if (block.type === "text") {
			textParts.push(block.text);
		} else if (block.type === "toolCall") {
			toolCallParams.push({
				id: block.id,
				type: "function",
				function: {
					name: block.name,
					arguments: JSON.stringify(block.arguments),
				},
			});
		}
	}

	const result: Record<string, unknown> = {
		role: "assistant",
		content: textParts.length > 0 ? textParts.join("") : null,
	};

	// 回传 reasoning 给支持它的模型（字段名记录在 thinkingSignature 里）
	const thinkingBlocks = msg.content.filter((b) => b.type === "thinking" && b.thinking.length > 0);
	if (thinkingBlocks.length > 0 && thinkingBlocks[0].type === "thinking") {
		const signature = thinkingBlocks[0].thinkingSignature;
		if (signature) {
			result[signature] = thinkingBlocks.map((b) => (b.type === "thinking" ? b.thinking : "")).join("\n");
		}
	}

	if (toolCallParams.length > 0) {
		result.tool_calls = toolCallParams;
	}

	return result as unknown as ChatCompletionMessageParam;
}

function convertToolResult(msg: ToolResultMessage): ChatCompletionMessageParam {
	const text = msg.content
		.filter((b): b is TextContent => b.type === "text")
		.map((b) => b.text)
		.join("\n");

	return {
		role: "tool",
		tool_call_id: msg.toolCallId,
		content: text,
	} as ChatCompletionMessageParam;
}

function convertTools(tools: Tool[], compat: OpenAICompatibility): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((tool) => {
		const base: OpenAI.Chat.Completions.ChatCompletionTool = {
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters as Record<string, unknown>,
			},
		};
		if (compat.supportsStrictTools) {
			base.function.strict = true;
		}
		return base;
	});
}

// 出向翻译：SDK chunk → 统一事件（纯函数，不接触 eventStream）

function applyChunk(
	output: AssistantMessage,
	state: StreamState,
	chunk: ChatCompletionChunk,
	reasoning: boolean,
): AssistantMessageEvent[] {
	const events: AssistantMessageEvent[] = [];

	if (chunk.usage) {
		output.usage = makeUsage(chunk.usage);
	}

	const choice = chunk.choices?.[0];
	if (!choice) return events;

	if (choice.finish_reason) {
		output.stopReason = mapStopReason(choice.finish_reason);
	}

	const delta = choice.delta;
	if (!delta) return events;

	// reasoning / thinking：嗅探 reasoning_content 和 reasoning 字段
	if (reasoning) {
		const raw = delta as Record<string, unknown>;
		const reasoningDelta = (raw.reasoning_content as string | undefined) ?? (raw.reasoning as string | undefined);
		const field = raw.reasoning_content ? "reasoning_content" : raw.reasoning ? "reasoning" : undefined;

		if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
			if (!state.thinkingStarted) {
				state.thinkingStarted = true;
				output.content.push({
					type: "thinking",
					thinking: "",
					thinkingSignature: field,
				});
				events.push({
					type: "thinking_start",
					contentIndex: output.content.length - 1,
					partial: output,
				});
			}
			const block = output.content[output.content.length - 1];
			if (block.type === "thinking") {
				block.thinking += reasoningDelta;
			}
			events.push({
				type: "thinking_delta",
				contentIndex: output.content.length - 1,
				delta: reasoningDelta,
				partial: output,
			});
		}
	}

	// text content
	if (delta.content) {
		if (state.thinkingStarted && !state.textStarted) {
			events.push(...closeThinking(output));
		}
		if (!state.textStarted) {
			state.textStarted = true;
			output.content.push({ type: "text", text: "" });
			events.push({
				type: "text_start",
				contentIndex: output.content.length - 1,
				partial: output,
			});
		}
		const block = output.content[output.content.length - 1];
		if (block.type === "text") {
			block.text += delta.content;
		}
		events.push({
			type: "text_delta",
			contentIndex: output.content.length - 1,
			delta: delta.content,
			partial: output,
		});
	}

	// tool calls：按 index 累积，支持并行调用
	if (delta.tool_calls) {
		if (state.thinkingStarted && state.toolCalls.size === 0 && !state.textStarted) {
			events.push(...closeThinking(output));
		}
		if (state.textStarted && state.toolCalls.size === 0) {
			events.push(...closeText(output));
		}

		for (const tc of delta.tool_calls) {
			let tcState = state.toolCalls.get(tc.index);
			if (!tcState) {
				output.content.push({
					type: "toolCall",
					id: tc.id ?? "",
					name: tc.function?.name ?? "",
					arguments: {},
				});
				tcState = {
					contentIndex: output.content.length - 1,
					id: tc.id ?? "",
					name: tc.function?.name ?? "",
					partialArgs: "",
				};
				state.toolCalls.set(tc.index, tcState);
				events.push({
					type: "toolcall_start",
					contentIndex: tcState.contentIndex,
					partial: output,
				});
			}

			if (tc.id && !tcState.id) tcState.id = tc.id;
			if (tc.function?.name && !tcState.name) tcState.name = tc.function.name;

			if (tc.function?.arguments) {
				tcState.partialArgs += tc.function.arguments;
				events.push({
					type: "toolcall_delta",
					contentIndex: tcState.contentIndex,
					delta: tc.function.arguments,
					partial: output,
				});
			}
		}
	}

	return events;
}

function finalizeBlocks(output: AssistantMessage, state: StreamState): AssistantMessageEvent[] {
	const events: AssistantMessageEvent[] = [];

	// reasoning-only 输出（无 text/tool call）时，thinking 还没被后续 block 关闭
	if (state.thinkingStarted && !state.textStarted && state.toolCalls.size === 0) {
		events.push(...closeThinking(output));
	}

	for (const [, tcState] of state.toolCalls) {
		const block = output.content[tcState.contentIndex];
		if (block.type === "toolCall") {
			block.id = tcState.id;
			block.name = tcState.name;
			try {
				block.arguments = tcState.partialArgs ? JSON.parse(tcState.partialArgs) : {};
			} catch {
				block.arguments = {};
			}
			events.push({
				type: "toolcall_end",
				contentIndex: tcState.contentIndex,
				toolCall: block,
				partial: output,
			});
		}
	}

	// 如果 text 还没被关闭（没有 tool calls 触发关闭）
	if (state.textStarted && state.toolCalls.size === 0) {
		events.push(...closeText(output));
	}

	return events;
}

function closeThinking(output: AssistantMessage): AssistantMessageEvent[] {
	const idx = output.content.findIndex((b) => b.type === "thinking");
	if (idx === -1) return [];
	const block = output.content[idx];
	if (block.type !== "thinking") return [];
	return [{ type: "thinking_end", contentIndex: idx, content: block.thinking, partial: output }];
}

function closeText(output: AssistantMessage): AssistantMessageEvent[] {
	const idx = output.content.findIndex((b) => b.type === "text");
	if (idx === -1) return [];
	const block = output.content[idx];
	if (block.type !== "text") return [];
	return [{ type: "text_end", contentIndex: idx, content: block.text, partial: output }];
}

// 工具函数

export function makeUsage(raw: {
	prompt_tokens?: number;
	completion_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
	completion_tokens_details?: { reasoning_tokens?: number };
}): Usage {
	const input = raw.prompt_tokens ?? 0;
	const output = raw.completion_tokens ?? 0;
	const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? 0;
	const reasoning = raw.completion_tokens_details?.reasoning_tokens;

	return {
		input,
		output,
		cacheRead,
		cacheWrite: 0,
		reasoning: reasoning ?? undefined,
		totalTokens: input + output,
		cost: zeroCost(),
	};
}

export function mapStopReason(reason: string | null): StopReason {
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "tool_calls":
		case "function_call":
			return "toolUse";
		default:
			return "error";
	}
}
