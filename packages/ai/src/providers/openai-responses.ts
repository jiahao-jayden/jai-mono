import { TaggedError } from "better-result";
import OpenAI from "openai";
import type {
	ResponseCreateParamsStreaming,
	ResponseInputItem,
	ResponseReasoningItem,
	ResponseStreamEvent,
	ResponseUsage,
} from "openai/resources/responses/responses";
import { createAssistantMessage, runAdapterStream } from "../adapter";
import { AssistantMessageEventStream } from "../event-stream";
import { type ModelDiscoveryOptions, modelDiscoveryFailed, type Provider, type StreamOptions } from "../provider";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	ImageContent,
	Message,
	Model,
	TextContent,
	ThinkingContent,
	Tool,
	ToolResultMessage,
	Usage,
} from "../types";
import { zeroCost } from "../utils";

export interface OpenAIResponsesProviderConfig {
	id?: string;
	apiKey: string;
	baseURL?: string;
	headers?: Readonly<Record<string, string>>;
	authentication?: "bearer" | "none";
}

interface BlockState {
	contentIndex: number;
	closed: boolean;
}

interface ToolCallState extends BlockState {
	partialArgs: string;
}

interface ResponsesStreamState {
	thinking: Map<string, BlockState>;
	text: Map<string, BlockState>;
	toolCalls: Map<string, ToolCallState>;
	hasToolCalls: boolean;
}

class ResponsesRequestFailed extends TaggedError("ai_provider.responses_request_failed")<{
	readonly message: string;
	readonly code?: string;
}> {}

const signaturePrefix = "openai-responses:";

export class OpenAIResponsesProvider implements Provider {
	readonly id: string;
	readonly adapter = "openai-responses" as const;
	private readonly client: OpenAI;
	private readonly baseURL?: string;
	private readonly headers?: Readonly<Record<string, string>>;
	private readonly authentication: "bearer" | "none";

	constructor(config: OpenAIResponsesProviderConfig) {
		this.id = config.id ?? this.adapter;
		this.baseURL = config.baseURL;
		this.headers = config.headers;
		this.authentication = config.authentication ?? "bearer";
		this.client = this.createClient(config.apiKey);
	}

	stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
		const eventStream = new AssistantMessageEventStream();
		this.run(eventStream, model, context, options);
		return eventStream;
	}

	async listModels(options?: ModelDiscoveryOptions): Promise<readonly string[]> {
		try {
			const page = await this.client.models.list(options?.signal ? { signal: options.signal } : undefined);
			return uniqueModelIds(
				page.data.map((model) => model.id),
				this.adapter,
			);
		} catch (cause) {
			throw modelDiscoveryFailed(this.adapter, cause);
		}
	}

	private async run(
		eventStream: AssistantMessageEventStream,
		model: Model,
		context: Context,
		options?: StreamOptions,
	): Promise<void> {
		const output = createAssistantMessage(this.id, model.id);
		const state: ResponsesStreamState = {
			thinking: new Map(),
			text: new Map(),
			toolCalls: new Map(),
			hasToolCalls: false,
		};

		await runAdapterStream(eventStream, output, options?.signal, {
			request: async () => {
				const client = options?.apiKey ? this.createClient(options.apiKey) : this.client;
				const params = buildParams(model, context, options);
				const providerOpts = options?.providerOptions?.[this.id] ?? options?.providerOptions?.[this.adapter];
				const body = providerOpts ? { ...params, ...providerOpts } : params;
				return client.responses.create(
					body as ResponseCreateParamsStreaming,
					options?.signal ? { signal: options.signal } : undefined,
				);
			},
			step: (event) => applyEvent(output, state, event),
			finalize: () => finalizeBlocks(output, state),
		});
	}

	private createClient(apiKey: string): OpenAI {
		return new OpenAI({
			apiKey,
			baseURL: this.baseURL,
			defaultHeaders: this.headers,
			...(this.authentication === "none" ? { fetch: withoutAuthentication } : {}),
		});
	}
}

function buildParams(model: Model, context: Context, options?: StreamOptions): ResponseCreateParamsStreaming {
	return {
		model: model.remoteModelId ?? model.id,
		stream: true,
		store: false,
		include: ["reasoning.encrypted_content"],
		instructions: context.systemPrompt || undefined,
		input: convertMessages(context.messages),
		max_output_tokens: options?.maxTokens ?? model.maxTokens,
		...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
		...(context.tools.length === 0 ? {} : { tools: convertTools(context.tools) }),
		...(model.reasoning ? { reasoning: { summary: "auto" } } : {}),
	};
}

function convertMessages(messages: Message[]): ResponseInputItem[] {
	const items: ResponseInputItem[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			items.push({
				type: "message",
				role: "user",
				content:
					typeof message.content === "string"
						? message.content
						: message.content.map((block) =>
								block.type === "text"
									? { type: "input_text" as const, text: block.text }
									: {
											type: "input_image" as const,
											detail: "auto" as const,
											image_url: `data:${block.mimeType};base64,${block.image}`,
										},
							),
			});
			continue;
		}

		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "thinking") {
					const reasoning = restoreReasoningItem(block);
					if (reasoning) items.push(reasoning);
				} else if (block.type === "text") {
					if (block.text) items.push({ type: "message", role: "assistant", content: block.text });
				} else {
					items.push({
						type: "function_call",
						call_id: block.id,
						name: block.name,
						arguments: JSON.stringify(block.arguments),
					});
				}
			}
			continue;
		}

		items.push(convertToolResult(message));
	}
	return items;
}

function convertToolResult(message: ToolResultMessage): ResponseInputItem {
	const text = message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	const images = message.content.filter((block): block is ImageContent => block.type === "image");
	return {
		type: "function_call_output",
		call_id: message.toolCallId,
		output:
			images.length === 0
				? text
				: [
						...(text ? [{ type: "input_text" as const, text }] : []),
						...images.map((block) => ({
							type: "input_image" as const,
							detail: "auto" as const,
							image_url: `data:${block.mimeType};base64,${block.image}`,
						})),
					],
	};
}

function convertTools(tools: Tool[]): OpenAI.Responses.FunctionTool[] {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as Record<string, unknown>,
		strict: true,
	}));
}

function applyEvent(
	output: AssistantMessage,
	state: ResponsesStreamState,
	event: ResponseStreamEvent,
): AssistantMessageEvent[] {
	switch (event.type) {
		case "response.reasoning_summary_text.delta":
		case "response.reasoning_text.delta":
			return applyThinkingDelta(output, state, event.item_id, event.delta);
		case "response.output_text.delta":
			return applyTextDelta(output, state, event.item_id, event.delta);
		case "response.output_item.added":
			if (event.item.type === "function_call") {
				return startToolCall(
					output,
					state,
					event.item.id ?? event.item.call_id,
					event.item.call_id,
					event.item.name,
				);
			}
			return [];
		case "response.function_call_arguments.delta": {
			const toolCall = state.toolCalls.get(event.item_id);
			if (!toolCall) return [];
			toolCall.partialArgs += event.delta;
			return [{ type: "toolcall_delta", contentIndex: toolCall.contentIndex, delta: event.delta, partial: output }];
		}
		case "response.output_item.done":
			return finishOutputItem(output, state, event.item);
		case "response.completed":
			applyUsage(output, event.response.usage);
			output.stopReason = state.hasToolCalls ? "toolUse" : "stop";
			return [];
		case "response.incomplete":
			applyUsage(output, event.response.usage);
			if (event.response.incomplete_details?.reason === "max_output_tokens") {
				output.stopReason = "length";
				return [];
			}
			throw new ResponsesRequestFailed({ message: "OpenAI response was blocked by the content filter" });
		case "response.failed":
			throw new ResponsesRequestFailed({
				message: event.response.error?.message ?? "OpenAI response failed",
				...(event.response.error?.code ? { code: event.response.error.code } : {}),
			});
		default:
			return [];
	}
}

function applyThinkingDelta(
	output: AssistantMessage,
	state: ResponsesStreamState,
	itemId: string,
	delta: string,
): AssistantMessageEvent[] {
	const events: AssistantMessageEvent[] = [];
	let blockState = state.thinking.get(itemId);
	if (!blockState) {
		output.content.push({ type: "thinking", thinking: "" });
		blockState = { contentIndex: output.content.length - 1, closed: false };
		state.thinking.set(itemId, blockState);
		events.push({ type: "thinking_start", contentIndex: blockState.contentIndex, partial: output });
	}
	const block = output.content[blockState.contentIndex];
	if (block.type === "thinking") block.thinking += delta;
	events.push({ type: "thinking_delta", contentIndex: blockState.contentIndex, delta, partial: output });
	return events;
}

function applyTextDelta(
	output: AssistantMessage,
	state: ResponsesStreamState,
	itemId: string,
	delta: string,
): AssistantMessageEvent[] {
	const events: AssistantMessageEvent[] = [];
	let blockState = state.text.get(itemId);
	if (!blockState) {
		output.content.push({ type: "text", text: "" });
		blockState = { contentIndex: output.content.length - 1, closed: false };
		state.text.set(itemId, blockState);
		events.push({ type: "text_start", contentIndex: blockState.contentIndex, partial: output });
	}
	const block = output.content[blockState.contentIndex];
	if (block.type === "text") block.text += delta;
	events.push({ type: "text_delta", contentIndex: blockState.contentIndex, delta, partial: output });
	return events;
}

function startToolCall(
	output: AssistantMessage,
	state: ResponsesStreamState,
	itemId: string,
	callId: string,
	name: string,
): AssistantMessageEvent[] {
	output.content.push({ type: "toolCall", id: callId, name, arguments: {} });
	const toolCall = { contentIndex: output.content.length - 1, partialArgs: "", closed: false };
	state.toolCalls.set(itemId, toolCall);
	state.hasToolCalls = true;
	return [{ type: "toolcall_start", contentIndex: toolCall.contentIndex, partial: output }];
}

function finishOutputItem(
	output: AssistantMessage,
	state: ResponsesStreamState,
	item: Extract<ResponseStreamEvent, { type: "response.output_item.done" }>["item"],
): AssistantMessageEvent[] {
	if (item.type === "reasoning") {
		let blockState = state.thinking.get(item.id);
		const startsHere = !blockState;
		if (!blockState && (item.summary.length > 0 || item.content?.length || item.encrypted_content)) {
			const thinking =
				item.summary.map((part) => part.text).join("\n") || item.content?.map((part) => part.text).join("\n") || "";
			output.content.push({ type: "thinking", thinking });
			blockState = { contentIndex: output.content.length - 1, closed: false };
			state.thinking.set(item.id, blockState);
		}
		if (!blockState) return [];
		const block = output.content[blockState.contentIndex];
		if (block.type !== "thinking") return [];
		block.thinkingSignature = preserveReasoningItem(item);
		blockState.closed = true;
		return [
			...(startsHere
				? [
						{
							type: "thinking_start" as const,
							contentIndex: blockState.contentIndex,
							partial: output,
						},
					]
				: []),
			{ type: "thinking_end", contentIndex: blockState.contentIndex, content: block.thinking, partial: output },
		];
	}

	if (item.type === "function_call") {
		const toolCall = (item.id ? state.toolCalls.get(item.id) : undefined) ?? state.toolCalls.get(item.call_id);
		if (!toolCall) return [];
		const block = output.content[toolCall.contentIndex];
		if (block.type !== "toolCall") return [];
		block.id = item.call_id;
		block.name = item.name;
		try {
			block.arguments = item.arguments ? JSON.parse(item.arguments) : {};
		} catch {
			block.arguments = {};
		}
		toolCall.closed = true;
		return [{ type: "toolcall_end", contentIndex: toolCall.contentIndex, toolCall: block, partial: output }];
	}

	if (item.type === "message") {
		const textState = state.text.get(item.id);
		if (!textState) return [];
		const block = output.content[textState.contentIndex];
		if (block.type !== "text") return [];
		textState.closed = true;
		return [{ type: "text_end", contentIndex: textState.contentIndex, content: block.text, partial: output }];
	}
	return [];
}

function finalizeBlocks(output: AssistantMessage, state: ResponsesStreamState): AssistantMessageEvent[] {
	const events: AssistantMessageEvent[] = [];
	for (const blockState of state.thinking.values()) {
		if (blockState.closed) continue;
		const block = output.content[blockState.contentIndex];
		if (block.type === "thinking") {
			events.push({
				type: "thinking_end",
				contentIndex: blockState.contentIndex,
				content: block.thinking,
				partial: output,
			});
		}
	}
	for (const blockState of state.text.values()) {
		if (blockState.closed) continue;
		const block = output.content[blockState.contentIndex];
		if (block.type === "text") {
			events.push({ type: "text_end", contentIndex: blockState.contentIndex, content: block.text, partial: output });
		}
	}
	for (const toolCall of state.toolCalls.values()) {
		if (toolCall.closed) continue;
		const block = output.content[toolCall.contentIndex];
		if (block.type !== "toolCall") continue;
		try {
			block.arguments = toolCall.partialArgs ? JSON.parse(toolCall.partialArgs) : {};
		} catch {
			block.arguments = {};
		}
		events.push({ type: "toolcall_end", contentIndex: toolCall.contentIndex, toolCall: block, partial: output });
	}
	return events;
}

function preserveReasoningItem(item: ResponseReasoningItem): string | undefined {
	if (!item.encrypted_content) return undefined;
	return `${signaturePrefix}${JSON.stringify({ id: item.id, encryptedContent: item.encrypted_content })}`;
}

function restoreReasoningItem(block: ThinkingContent): ResponseReasoningItem | undefined {
	if (!block.thinkingSignature?.startsWith(signaturePrefix)) return undefined;
	try {
		const value = JSON.parse(block.thinkingSignature.slice(signaturePrefix.length)) as {
			id?: unknown;
			encryptedContent?: unknown;
		};
		if (typeof value.id !== "string" || typeof value.encryptedContent !== "string") return undefined;
		return {
			type: "reasoning",
			id: value.id,
			summary: block.thinking ? [{ type: "summary_text", text: block.thinking }] : [],
			encrypted_content: value.encryptedContent,
		};
	} catch {
		return undefined;
	}
}

function applyUsage(output: AssistantMessage, usage: ResponseUsage | null | undefined): void {
	if (usage) output.usage = makeResponsesUsage(usage);
}

function makeResponsesUsage(raw: ResponseUsage): Usage {
	return {
		input: raw.input_tokens,
		output: raw.output_tokens,
		cacheRead: raw.input_tokens_details.cached_tokens,
		cacheWrite: 0,
		reasoning: raw.output_tokens_details.reasoning_tokens || undefined,
		totalTokens: raw.total_tokens,
		cost: zeroCost(),
	};
}

function uniqueModelIds(values: readonly unknown[], adapter: string): string[] {
	const modelIds = values.map((value) => {
		if (typeof value !== "string" || !value.trim()) throw modelDiscoveryFailed(adapter, undefined);
		return value;
	});
	return [...new Set(modelIds)].sort((left, right) => left.localeCompare(right));
}

async function withoutAuthentication(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const request = input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
	const headers = new Headers(request.headers);
	headers.delete("authorization");
	headers.delete("x-api-key");
	return fetch(new Request(request, { headers }));
}
