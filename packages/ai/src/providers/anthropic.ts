import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
	RawContentBlockDeltaEvent,
	RawContentBlockStartEvent,
	RawContentBlockStopEvent,
	RawMessageDeltaEvent,
	RawMessageStartEvent,
	RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages.js";
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
	StopReason,
	TextContent,
	Tool,
	ToolResultMessage,
	Usage,
} from "../types";
import { zeroCost } from "../utils";

export interface AnthropicProviderConfig {
	apiKey: string;
	baseURL?: string;
}

const CACHE_CONTROL = { type: "ephemeral" as const };

/** 流式过程中每个 content block 的内部状态（sdkIndex → 我们的 contentIndex + 累积碎片） */
interface BlockState {
	contentIndex: number;
	partialJson?: string;
	partialSignature?: string;
}

// 入口：Provider 类

export class AnthropicProvider implements Provider {
	readonly id = "anthropic";
	private readonly client: Anthropic;

	constructor(config: AnthropicProviderConfig) {
		this.client = new Anthropic({
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
		const blockStates = new Map<number, BlockState>();

		await runAdapterStream(eventStream, output, options?.signal, {
			request: async () => {
				const client = options?.apiKey
					? new Anthropic({ apiKey: options.apiKey, baseURL: model.baseUrl })
					: this.client;

				const params = buildParams(model, context, options);
				const providerOpts = options?.providerOptions?.anthropic;
				const body = providerOpts ? { ...params, ...providerOpts } : params;

				return client.messages.create(
					body as MessageCreateParamsStreaming,
					options?.signal ? { signal: options.signal } : undefined,
				);
			},
			step: (event) => translateEvent(output, blockStates, event),
			// Anthropic 每个 block 都有显式 stop 事件，不需要收尾
			finalize: () => [],
		});
	}
}

// 入向翻译：Context → Anthropic SDK 请求体

function buildParams(model: Model, context: Context, options?: StreamOptions): MessageCreateParamsStreaming {
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		max_tokens: options?.maxTokens ?? model.maxTokens,
		stream: true,
		messages: convertMessages(context.messages),
	};

	// breakpoint 1: system prompt
	if (context.systemPrompt) {
		params.system = [
			{
				type: "text",
				text: context.systemPrompt,
				cache_control: CACHE_CONTROL,
			},
		];
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools.length > 0) {
		params.tools = convertTools(context.tools);
	}

	return params;
}

function convertMessages(messages: Message[]): MessageParam[] {
	const params: MessageParam[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		if (msg.role === "user") {
			params.push({ role: "user", content: convertUserContent(msg) });
		} else if (msg.role === "assistant") {
			const blocks = convertAssistantContent(msg);
			if (blocks.length > 0) {
				params.push({ role: "assistant", content: blocks });
			}
		} else if (msg.role === "toolResult") {
			const toolResults: ContentBlockParam[] = [];
			toolResults.push(buildToolResultBlock(msg));

			let j = i + 1;
			while (j < messages.length && messages[j].role === "toolResult") {
				toolResults.push(buildToolResultBlock(messages[j] as ToolResultMessage));
				j++;
			}
			i = j - 1;

			params.push({ role: "user", content: toolResults });
		}
	}

	applyCacheBreakpointToLastUser(params);
	return params;
}

function convertUserContent(msg: { content: string | (TextContent | ImageContent)[] }): string | ContentBlockParam[] {
	if (typeof msg.content === "string") return msg.content;

	return msg.content.map((block): ContentBlockParam => {
		if (block.type === "text") {
			return { type: "text" as const, text: block.text };
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.image,
			},
		};
	});
}

function convertAssistantContent(msg: AssistantMessage): ContentBlockParam[] {
	const blocks: ContentBlockParam[] = [];
	for (const block of msg.content) {
		if (block.type === "text") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "thinking") {
			if (block.thinkingSignature) {
				blocks.push({
					type: "thinking",
					thinking: block.thinking,
					signature: block.thinkingSignature,
				});
			} else {
				blocks.push({ type: "text", text: block.thinking });
			}
		} else if (block.type === "toolCall") {
			blocks.push({
				type: "tool_use",
				id: block.id,
				name: block.name,
				input: block.arguments,
			});
		}
	}
	return blocks;
}

function buildToolResultBlock(msg: ToolResultMessage): ContentBlockParam {
	const content = convertToolResultContent(msg.content);
	return {
		type: "tool_result",
		tool_use_id: msg.toolCallId,
		content,
		is_error: msg.isError,
	} as ContentBlockParam;
}

function convertToolResultContent(content: (TextContent | ImageContent)[]): string | ContentBlockParam[] {
	if (!content.some((c) => c.type === "image")) {
		return content.map((c) => (c as TextContent).text).join("\n");
	}
	return content.map((block): ContentBlockParam => {
		if (block.type === "text") {
			return { type: "text", text: block.text };
		}
		return {
			type: "image",
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.image,
			},
		};
	}) as ContentBlockParam[];
}

// breakpoint 3: 最后一条 user/tool_result message 的最后一个 content block
function applyCacheBreakpointToLastUser(params: MessageParam[]): void {
	for (let i = params.length - 1; i >= 0; i--) {
		const p = params[i];
		if (p.role !== "user" || !Array.isArray(p.content)) continue;
		const blocks = p.content as ContentBlockParam[];
		const last = blocks[blocks.length - 1];
		if (last) {
			(last as unknown as Record<string, unknown>).cache_control = CACHE_CONTROL;
		}
		break;
	}
}

// breakpoint 2: 最后一个工具定义
function convertTools(tools: Tool[]): Anthropic.Messages.Tool[] {
	return tools.map((tool, index) => {
		const schema = tool.parameters as {
			properties?: unknown;
			required?: string[];
		};
		const base: Anthropic.Messages.Tool = {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object" as const,
				properties: (schema.properties ?? {}) as Record<string, unknown>,
				required: schema.required ?? [],
			},
		};
		if (index === tools.length - 1) {
			base.cache_control = CACHE_CONTROL;
		}
		return base;
	});
}

// 出向翻译：SDK 流事件 → 统一事件（纯函数，不接触 eventStream）

function translateEvent(
	output: AssistantMessage,
	blockStates: Map<number, BlockState>,
	event: RawMessageStreamEvent,
): AssistantMessageEvent[] {
	switch (event.type) {
		case "message_start":
			applyMessageStart(output, event);
			return [];
		case "content_block_start":
			return applyBlockStart(output, blockStates, event);
		case "content_block_delta":
			return applyBlockDelta(output, blockStates, event);
		case "content_block_stop":
			return applyBlockStop(output, blockStates, event);
		case "message_delta":
			applyMessageDelta(output, event);
			return [];
		default:
			return [];
	}
}

function applyMessageStart(output: AssistantMessage, event: RawMessageStartEvent): void {
	const u = event.message.usage;
	const raw = u as unknown as Record<string, number | undefined>;
	output.usage = makeUsage({
		inputTokens: u.input_tokens,
		outputTokens: u.output_tokens,
		cacheReadTokens: raw.cache_read_input_tokens,
		cacheWriteTokens: raw.cache_creation_input_tokens,
	});
}

function applyBlockStart(
	output: AssistantMessage,
	blockStates: Map<number, BlockState>,
	event: RawContentBlockStartEvent,
): AssistantMessageEvent[] {
	const cb = event.content_block;
	const contentIndex = output.content.length;

	if (cb.type === "text") {
		output.content.push({ type: "text", text: "" });
		blockStates.set(event.index, { contentIndex });
		return [{ type: "text_start", contentIndex, partial: output }];
	}
	if (cb.type === "thinking") {
		output.content.push({
			type: "thinking",
			thinking: "",
			thinkingSignature: "",
		});
		blockStates.set(event.index, {
			contentIndex,
			partialSignature: "",
		});
		return [{ type: "thinking_start", contentIndex, partial: output }];
	}
	if (cb.type === "tool_use") {
		output.content.push({
			type: "toolCall",
			id: cb.id,
			name: cb.name,
			arguments: {},
		});
		blockStates.set(event.index, { contentIndex, partialJson: "" });
		return [{ type: "toolcall_start", contentIndex, partial: output }];
	}
	return [];
}

function applyBlockDelta(
	output: AssistantMessage,
	blockStates: Map<number, BlockState>,
	event: RawContentBlockDeltaEvent,
): AssistantMessageEvent[] {
	const state = blockStates.get(event.index);
	if (!state) return [];

	const block = output.content[state.contentIndex];
	const delta = event.delta;

	if (delta.type === "text_delta" && block.type === "text") {
		block.text += delta.text;
		return [
			{
				type: "text_delta",
				contentIndex: state.contentIndex,
				delta: delta.text,
				partial: output,
			},
		];
	}
	if (delta.type === "thinking_delta" && block.type === "thinking") {
		block.thinking += delta.thinking;
		return [
			{
				type: "thinking_delta",
				contentIndex: state.contentIndex,
				delta: delta.thinking,
				partial: output,
			},
		];
	}
	if (delta.type === "signature_delta" && block.type === "thinking") {
		state.partialSignature = (state.partialSignature ?? "") + delta.signature;
		block.thinkingSignature = state.partialSignature;
		return [];
	}
	if (delta.type === "input_json_delta" && block.type === "toolCall") {
		state.partialJson = (state.partialJson ?? "") + delta.partial_json;
		return [
			{
				type: "toolcall_delta",
				contentIndex: state.contentIndex,
				delta: delta.partial_json,
				partial: output,
			},
		];
	}
	return [];
}

function applyBlockStop(
	output: AssistantMessage,
	blockStates: Map<number, BlockState>,
	event: RawContentBlockStopEvent,
): AssistantMessageEvent[] {
	const state = blockStates.get(event.index);
	if (!state) return [];

	const block = output.content[state.contentIndex];
	blockStates.delete(event.index);

	if (block.type === "text") {
		return [
			{
				type: "text_end",
				contentIndex: state.contentIndex,
				content: block.text,
				partial: output,
			},
		];
	}
	if (block.type === "thinking") {
		return [
			{
				type: "thinking_end",
				contentIndex: state.contentIndex,
				content: block.thinking,
				partial: output,
			},
		];
	}
	if (block.type === "toolCall") {
		try {
			block.arguments = state.partialJson ? JSON.parse(state.partialJson) : {};
		} catch {
			block.arguments = {};
		}
		return [
			{
				type: "toolcall_end",
				contentIndex: state.contentIndex,
				toolCall: block,
				partial: output,
			},
		];
	}
	return [];
}

function applyMessageDelta(output: AssistantMessage, event: RawMessageDeltaEvent): void {
	if (event.delta.stop_reason) {
		output.stopReason = mapStopReason(event.delta.stop_reason);
	}

	const raw = event.usage as unknown as Record<string, number | undefined>;

	if (raw.output_tokens != null) {
		output.usage.output = raw.output_tokens;
	}
	if (raw.cache_read_input_tokens != null) {
		output.usage.cacheRead = raw.cache_read_input_tokens;
	}
	if (raw.cache_creation_input_tokens != null) {
		output.usage.cacheWrite = raw.cache_creation_input_tokens;
	}

	output.usage.totalTokens = output.usage.input + output.usage.output;
}

// 工具函数

export function makeUsage(raw: {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}): Usage {
	const cacheRead = raw.cacheReadTokens ?? 0;
	const cacheWrite = raw.cacheWriteTokens ?? 0;
	// inclusive: input = raw input + cache tokens
	const input = raw.inputTokens + cacheRead + cacheWrite;
	const output = raw.outputTokens;
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output,
		cost: zeroCost(),
	};
}

export function mapStopReason(reason: string): StopReason {
	switch (reason) {
		case "end_turn":
		case "stop_sequence":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		default:
			return "error";
	}
}
