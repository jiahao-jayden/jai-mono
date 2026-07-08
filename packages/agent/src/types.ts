import type { ImageContent, TextContent, Tool } from "@jai/ai";
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
