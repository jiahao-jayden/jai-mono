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
	ToolFileChange,
	ToolResultMessage,
} from "@jai/ai";

import type { Static, TSchema } from "@sinclair/typebox";
import type { EffectGate } from "./effect-gate";

export interface AgentToolResult<TDetails = unknown> {
	/** 回给模型的内容（会被包进 ToolResultMessage 送回 LLM）。 */
	content: (TextContent | ImageContent)[];
	/**
	 * 完成的文件副作用；这是可进入 T2 tool-result fact 的受限白名单，不能用
	 * `details` 代替。路径由 workspace tool 归一为 canonical absolute path。
	 */
	fileChanges?: readonly ToolFileChange[];
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
	/**
	 * 执行工具。参数已由 loop 校验并转换为 Static<T>。
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

/**
 * A storage-agnostic intent-before-effect seam. The Agent core never decides
 * what an intent record means or where it is stored; a Runtime Host supplies
 * this contract when an external model or tool effect needs durable recovery.
 */
export interface EffectBoundary {
	beforeModelEffect(input: {
		readonly context: AgentContext;
		readonly model: Model;
		readonly signal?: AbortSignal;
	}): Promise<EffectEntryReservation>;
	beforeToolEffect(input: {
		readonly toolCall: ToolCall;
		readonly tool: AgentTool;
		readonly args: Record<string, unknown>;
		readonly signal?: AbortSignal;
	}): Promise<EffectEntryReservation>;
	afterModelEffect(input: {
		readonly reservation: EffectEntryReservation;
		readonly message: AssistantMessage;
	}): Promise<void>;
}

/** Preallocated Session Journal entry identity for the effect's durable result. */
export interface EffectEntryReservation {
	readonly entryId: string;
}

export type AgentMessage = Message;

/**
 * 生命周期分三层，由外到内：
 * - run：一次 agentLoop 调用，可包含多个 turn（agent_start / agent_end）。
 * - turn：一次 LLM 响应 + 它触发的工具执行（turn_start / turn_end）。
 * - message / tool_execution：turn 内部的消息与工具粒度事件。
 *
 * 事件必须保持 wire-safe：payload 可 JSON round-trip，不携带 Error、函数、
 * class 实例、stream 或 signal。跨进程传输时才不需要另一套投影。
 */
export type CoreAgentEvent =
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
	| { type: "message_end"; message: AgentMessage; entryId?: string }
	/**
	 * 一次已经流式发布出去的 assistant 尝试被丢弃了（协议违规重试、或 provider
	 * 在 start 之后失败）。消费者必须撤掉为它渲染的内容：后续重试会以新的
	 * `message_start` 重新开始，而不是接着写。
	 */
	| { type: "message_discard" }
	// 工具执行生命周期
	| {
			type: "tool_execution_start";
			toolCallId: string;
			toolName: string;
			args: unknown;
	  }
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			partial: AgentToolResult;
	  }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: AgentToolResult;
			isError: boolean;
	  };

/**
 * 一次流式调用：既可迭代过程事件，也可等待最终结果。
 * 各层只在事件联合上不同，结构因此只写一份。
 */
export interface EventRun<TEvent, TResult> extends AsyncIterable<TEvent> {
	result(): Promise<TResult>;
}

/** observer 抛错时的上报载荷。它不是事件，不会再触发一轮分发。 */
export interface ObserverErrorInfo<TEvent> {
	error: unknown;
	event: TEvent;
}

export interface AgentLoopConfig {
	/** 目标模型元数据。 */
	model: Model;
	/** 发起流式调用的 provider 。可注入 mock 做测试。 */
	provider: Provider;
	/** 采样温度，透传给 provider。 */
	temperature?: number;
	/** 输出 token 上限，透传给 provider。 */
	maxTokens?: number;
	/** Provider adapter 的受限请求选项，按 provider id 或 adapter 名分组。 */
	providerOptions?: Record<string, Record<string, unknown>>;
	/** 单次 invoke 中可发起的最大 model turn 数。 */
	maxIterations?: number;
	/** 工具执行模式，默认 "parallel"。 */
	toolExecution?: ToolExecutionMode;
	/**
	 * 工具执行的拦截链（洋葱模型），按数组顺序自外向内包裹 execute。
	 * 用于权限、参数改写、结果包装、重试等横切逻辑。默认无。
	 */
	toolMiddlewares?: ToolMiddleware[];
	/** Optional Runtime Host intent-before-effect contract for this invocation. */
	effectBoundary?: EffectBoundary;
	/** Optional crash-prefix gate; omitted in automatic production execution. */
	effectGate?: EffectGate;
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
	/**
	 * 每次 model call 前调用，返回本次请求实际使用的 context。
	 * 收到的是本次请求的副本，返回值只影响这一次请求，不会改写 Agent 的 transcript。
	 * 动态 system prompt 与后续 compaction 都接在这个点位上。默认无（原样使用）。
	 */
	prepareContext?: PrepareContext;
	/**
	 * model 请求失败或输出协议错误时调用，返回 directive 则重试一次。
	 * provider 尚未发出 start 的请求失败可以直接重试；输出协议错误由 core 在 attempt
	 * 事务中重试，因此不会留下已发布的 partial。每次 model call 最多接受一次 directive。
	 */
	onModelError?: OnModelError;
}

export type PrepareContext = (context: AgentContext) => AgentContext | Promise<AgentContext>;

export interface RetryModelCall {
	type: "retry";
	/** 已完成 Prompt 与 compaction 的 provider-ready context；core 不再调用 prepareContext。 */
	context: AgentContext;
}

export type OnModelError = (
	error: AssistantMessage,
	context: AgentContext,
) => RetryModelCall | undefined | Promise<RetryModelCall | undefined>;

export interface AgentContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools: AgentTool[];
}
