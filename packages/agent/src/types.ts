import type {
	AssistantMessage,
	ImageContent,
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
	| { type: "agent_end"; messages: AssistantMessage[] };

export type BeforeToolCallContext = {
	toolCallId: string;
	toolName: string;
	args: unknown;
};

export type BeforeToolCallResult = {
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
