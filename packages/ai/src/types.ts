import type { TSchema } from "@sinclair/typebox";

/* -------------------------------------------------------------------------- */
/*                             内容块 Content Blocks                             */
/* -------------------------------------------------------------------------- */
export interface TextContent {
	type: "text";
	text: string;
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

/* -------------------------------------------------------------------------- */
/*                                 消息 Message                                 */
/* -------------------------------------------------------------------------- */
export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	provider: string;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
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
export type Api = "anthropic-messages" | "openai-chat-completions" | (string & {});
export type ProviderId = "anthropic" | "openai-compatible" | (string & {});
export type ModelInput = "text" | "image";

export interface ModelCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
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
	name: string;
	api: TApi;
	provider: ProviderId;
	baseUrl: string;
	reasoning: boolean;
	input: ModelInput[];
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	compatibility?: TApi extends "openai-chat-completions"
		? OpenAICompatibility
		: TApi extends "anthropic-messages"
			? AnthropicCompatibility
			: ModelCompatibility;
}

/* -------------------------------------------------------------------------- */
/*                             Usage & StopReason & ErrorMessage                    */
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

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

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
	| { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
	| { type: "error"; reason: Extract<StopReason, "error" | "aborted">; error: AssistantMessage };
