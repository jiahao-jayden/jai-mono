import type { TSchema } from "@sinclair/typebox";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/* -------------------------------------------------------------------------- */
/*                             内容块 Content Blocks                             */
/* -------------------------------------------------------------------------- */
export interface TextContent {
	type: "text";
	text: string;
	/** Product-injected context visible to providers but omitted from user-facing projections. */
	synthetic?: boolean;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	/**
	 * 部分模型多轮对话时需要把 thinking signature 原样回传，
	 * 否则 provider 可能拒绝请求。
	 */
	thinkingSignature?: string;
}

export interface ImageContent {
	type: "image";
	image: string;
	mimeType: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/**
 * A narrow, durable description of a filesystem effect completed by a tool.
 *
 * This is deliberately separate from a tool's arbitrary `details`: it can be
 * safely persisted with the tool-result message and projected by Hosts without
 * leaking implementation-specific result data into a client protocol. Paths
 * are canonical absolute paths when emitted by workspace tools.
 */
export interface ToolFileChange {
	readonly operation: "add" | "modify" | "delete";
	readonly path: string;
}

/* -------------------------------------------------------------------------- */
/*                                 消息 Message                                 */
/* -------------------------------------------------------------------------- */
export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	/** Product-owned, wire-safe annotations. Providers must ignore this field. */
	metadata?: Readonly<Record<string, JsonValue>>;
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	provider: string;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	error?: ProviderErrorInfo;
	timestamp: number;
}

/** Provider SDK 异常的 wire-safe 投影；不保留不可序列化的原始 Error。 */
export interface ProviderErrorInfo {
	message: string;
	status?: number;
	code?: string;
	type?: string;
	requestId?: string;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	/** Durable, LLM-invisible filesystem facts produced by this completed tool call. */
	fileChanges?: readonly ToolFileChange[];
	isError: boolean;
	timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/* -------------------------------------------------------------------------- */
/*                               Context & Tool                               */
/* -------------------------------------------------------------------------- */
export interface Tool<T extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: T;
}

export interface Context {
	systemPrompt: string;
	messages: Message[];
	tools: Tool[];
}
/* -------------------------------------------------------------------------- */
/*                                    Model                                   */
/* -------------------------------------------------------------------------- */
export type Api = "anthropic-messages" | "openai-chat-completions" | "openai-responses" | (string & {});
export type ProviderId = "anthropic" | "openai-compatible" | "openai-responses" | (string & {});
export type ProviderAdapter = "anthropic" | "openai-compatible" | "openai-responses";
export type ModelInput = "text" | "image";
export type ModelModality = ModelInput | "audio" | "video" | "pdf";

export interface ModelCost {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	reasoning?: number;
}

/** Catalog metadata. Only text/image are currently accepted by Context. */
export interface ModelModalities {
	input: ModelModality[];
	output: ModelModality[];
}

export interface ModelCapabilities {
	toolCall?: boolean;
	structuredOutput?: boolean;
}

export interface OpenAICompatibility {
	maxTokensField?: "max_tokens" | "max_completion_tokens";
	supportsUsageInStreaming?: boolean;
	supportsStrictTools?: boolean;
	reasoningFormat?: "openai" | "deepseek" | "none";
}

export interface AnthropicCompatibility {
	supportsThinking?: boolean;
}

export type ModelCompatibility = OpenAICompatibility | AnthropicCompatibility;

export interface Model<TApi extends Api = Api> {
	id: string;
	/** Provider-facing model id. Defaults to id for legacy callers. */
	remoteModelId?: string;
	name: string;
	api: TApi;
	provider: ProviderId;
	/** @deprecated The provider connection owns its base URL. */
	baseUrl?: string;
	reasoning?: boolean;
	input: ModelInput[];
	modalities?: ModelModalities;
	capabilities?: ModelCapabilities;
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	compatibility?: TApi extends "openai-chat-completions"
		? OpenAICompatibility
		: TApi extends "openai-responses"
			? OpenAICompatibility
			: TApi extends "anthropic-messages"
				? AnthropicCompatibility
				: ModelCompatibility;
}

/* -------------------------------------------------------------------------- */
/*                              Usage & StopReason                              */
/* -------------------------------------------------------------------------- */
export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "contextOverflow" | "iterationLimit" | "error" | "aborted";

/* -------------------------------------------------------------------------- */
/*                                    Event                                   */
/* -------------------------------------------------------------------------- */

export type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| {
			type: "done";
			reason: Extract<StopReason, "stop" | "length" | "toolUse" | "contextOverflow" | "iterationLimit">;
			message: AssistantMessage;
	  }
	| { type: "error"; reason: Extract<StopReason, "error" | "aborted">; error: AssistantMessage };
