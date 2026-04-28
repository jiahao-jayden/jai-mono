import type {
	AssistantMessage,
	ImageContent,
	JSONSchema7,
	Message,
	StreamEvent,
	TextContent,
	ToolDefinition,
	ToolParameters,
	ToolResultMessage,
} from "@jayden/jai-ai";
import type z from "zod";

export type AgentToolResult<TDetails = unknown> = {
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	isError?: boolean;
};

// 推断工具调用参数类型：Zod 走 z.infer，JSON Schema 退化为 unknown（运行时校验或工具自管）
type InferToolInput<TParams extends ToolParameters> = TParams extends z.ZodType ? z.infer<TParams> : unknown;

export type AgentTool<TParams extends ToolParameters = ToolParameters> = ToolDefinition<TParams> & {
	label: string;
	lazy?: boolean;
	validate?(params: InferToolInput<TParams>): string | undefined;
	execute(params: InferToolInput<TParams>, signal?: AbortSignal): Promise<unknown>;
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
	| { type: "compaction_end"; summary: string }
	| { type: "title_generated"; title: string };

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

/**
 * 用 JSON Schema 直接定义 AgentTool（typically MCP 工具——schema 来自远端 server）。
 * 参数类型为 unknown，由 execute 自己处理 / 校验。
 */
export function defineJsonSchemaTool(config: AgentTool<JSONSchema7>): AgentTool {
	return config as AgentTool;
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
