import type {
	AssistantMessage,
	ImageContent,
	Message,
	StreamEvent,
	TextContent,
	ToolDefinition,
	ToolResultMessage,
} from "@jayden/jai-ai";
import type z from "zod";

export type AgentToolResult<TDetails = unknown> = {
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	isError?: boolean;
};

export type AgentTool<TParams extends z.ZodType = z.ZodType> = ToolDefinition<TParams> & {
	label: string;
	lazy?: boolean;
	validate?(params: z.infer<TParams>): string | undefined;
	execute(params: z.infer<TParams>, signal?: AbortSignal): Promise<unknown>;
};

export type AgentEvent =
	| { type: "agent_start" }
	| { type: "turn_start" }
	| { type: "stream"; event: StreamEvent }
	| { type: "message_end"; message: AssistantMessage | ToolResultMessage }
	| { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_update"; toolCallId: string; partial: AgentToolResult }
	| { type: "tool_end"; toolCallId: string; result: AgentToolResult }
	| { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
	| { type: "agent_end"; messages: AssistantMessage[] }
	| { type: "compaction_start" }
	| { type: "compaction_end"; summary: string };

export type BeforeToolCallContext = {
	toolCallId: string;
	toolName: string;
	args: unknown;
};

export type BeforeToolCallResult = {
	/** Skip real tool execution and use this result instead */
	skip?: boolean;
	result?: AgentToolResult;
	/** Rewrite tool input before execution */
	input?: unknown;
	/** Legacy: block with reason (rendered as error tool result) */
	block?: boolean;
	reason?: string;
};

export type AfterToolCallContext = {
	toolCallId: string;
	toolName: string;
	result: AgentToolResult;
	isError: boolean;
};

export type AfterToolCallResult = {
	content?: (TextContent | ImageContent)[];
	isError?: boolean;
};

export function defineAgentTool<TParams extends z.ZodType>(config: AgentTool<TParams>): AgentTool<TParams> {
	return config;
}

export type PreModelRequestContext = {
	messages: Message[];
	systemPrompt?: string;
	tools: AgentTool[];
};

export type PreModelRequestResult = {
	messages?: Message[];
	systemPrompt?: string;
	tools?: AgentTool[];
};
