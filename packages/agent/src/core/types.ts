import type {
	AssistantMessage,
	AssistantMessageEvent,
	ImageContent,
	Message,
	Model,
	Provider,
	TextContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "@jai/ai";
import type { Static, TSchema } from "@sinclair/typebox";

export interface AgentToolResult<TDetails = unknown> {
	/** 回给模型的内容（会被包进 ToolResultMessage 送回 LLM）。 */
	content: (TextContent | ImageContent)[];
	/** 给日志 / UI 的结构化数据，不进 LLM 上下文。 */
	details?: TDetails;
	/**
	 * 提示 agent 在当前这批工具执行完后停止。
	 * 早停仅当本批次每个工具结果都为 true 时才生效
	 */
	terminate?: boolean;
}

/** 长任务在 execute 途中回调，驱动 tool_execution_update 事件。 */
export type ToolUpdateCallback<TDetails = unknown> = (partial: AgentToolResult<TDetails>) => void;

export type ToolExecutionMode = "sequential" | "parallel";

export interface AgentTool<T extends TSchema = TSchema, TDetails = unknown> extends Tool<T> {
	/** UI 展示用的人类可读标签，缺省用 name。 */
	label?: string;
	/**
	 * 执行工具。参数已由 loop 用 Spec 06 校验并 coerce，这里直接拿干净的 Static<T>。
	 * 失败请 throw，由 loop 捕获转成 isError 的 ToolResultMessage。
	 */
	execute(
		toolCallId: string,
		args: Static<T>,
		signal?: AbortSignal,
		onUpdate?: ToolUpdateCallback<TDetails>,
	): Promise<AgentToolResult<TDetails>>;
	/**
	 * 单个工具的执行模式覆盖：
	 * - "sequential"：此工具必须与其他工具串行执行（如写文件、跑命令）。
	 * - "parallel"：可与其他工具并发（如只读查询）。
	 */
	executionMode?: ToolExecutionMode;
}

/** 传给中间件的单次调用上下文：定位、校验后、execute 前的快照。 */
export interface ToolCallContext {
	toolCall: ToolCall;
	tool: AgentTool;
	/** 已校验的参数；中间件可在调用 next() 前改写它。 */
	args: Record<string, unknown>;
	signal?: AbortSignal;
}

/**
 * 工具执行中间件（洋葱模型）。拿到 ctx 与内层 next：
 * - 调 next() 前改 ctx.args → 相当于 prepareArguments。
 * - 不调 next() 直接返回 → 相当于 beforeToolCall 否决（如权限拦截）。
 * - await next() 后包装结果 → 相当于 afterToolCall。
 */
export type ToolMiddleware = (ctx: ToolCallContext, next: () => Promise<AgentToolResult>) => Promise<AgentToolResult>;

export type AgentMessage = Message;

/**
 * 生命周期分三层，由外到内：
 * - run：一次 agentLoop 调用，可包含多个 turn（agent_start / agent_end）。
 * - turn：一次 LLM 响应 + 它触发的工具执行（turn_start / turn_end）。
 * - message / tool_execution：turn 内部的消息与工具粒度事件。
 */
export type AgentEvent =
	// run 生命周期：一次 agentLoop 调用的最外层边界
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	// turn 生命周期：一个 turn = 一条 assistant 回复 + 它触发的工具执行
	| { type: "turn_start" }
	| { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
	// message 生命周期：user / assistant / toolResult 消息进入 transcript
	| { type: "message_start"; message: AgentMessage }
	// 仅 assistant 流式期间发出，透传底层 provider 的细粒度事件
	| { type: "message_update"; message: AssistantMessage; assistantEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	// 工具执行生命周期
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; partial: AgentToolResult }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: AgentToolResult; isError: boolean };

export interface AgentLoopConfig {
	/** 目标模型元数据。 */
	model: Model;
	/** 发起流式调用的 provider 。可注入 mock 做测试。 */
	provider: Provider;
	/** 采样温度，透传给 provider。 */
	temperature?: number;
	/** 输出 token 上限，透传给 provider。 */
	maxTokens?: number;
	/** 工具执行模式，默认 "parallel"。 */
	toolExecution?: ToolExecutionMode;
	/**
	 * 工具执行的拦截链（洋葱模型），按数组顺序自外向内包裹 execute。
	 * 用于权限、参数改写、结果包装、重试等横切逻辑。默认无。
	 */
	toolMiddlewares?: ToolMiddleware[];
	/**
	 * steering 接入点：一个 turn 的工具执行完后调用，返回的消息在下一次 LLM 请求前注入。
	 * loop 只调用它，不持有队列。默认无（返回 []）。
	 */
	getSteeringMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;
	/**
	 * follow-up 接入点：agent 本该停下时调用，有消息则继续新一轮。
	 * loop 只调用它，不持有队列。默认无（返回 []）。
	 */
	getFollowUpMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;
}

export interface AgentContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools: AgentTool[];
}
