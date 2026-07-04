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

export interface ToolCallContent {
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
	content: string | (TextContent | ImageContent | ToolCallContent)[];
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

export interface OpenAICompat {
	maxTokensField?: "max_tokens" | "max_completion_tokens";
	supportsUsageInStreaming?: boolean;
	supportsStrictTools?: boolean;
	reasoningFormat?: "openai" | "deepseek" | "none";
}

export interface AnthropicCompat {
	supportsThinking?: boolean;
}

export type ModelCompat = OpenAICompat | AnthropicCompat;

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
	compat?: TApi extends "openai-chat-completions"
		? OpenAICompat
		: TApi extends "anthropic-messages"
			? AnthropicCompat
			: ModelCompat;
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
		reasoning?: number;
		totalTokens: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
