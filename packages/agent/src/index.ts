// 跨层共享的消息、工具与状态类型。执行器本身只在 @jai/agent/core 暴露，
// 显式列举是为了避免以后新增 core 类型时意外扩大默认 API。
export {
	type AgentContext,
	type AgentInput,
	type AgentMessage,
	type AgentState,
	type AgentTool,
	type AgentToolResult,
	cloneJson,
	type JsonObject,
	type JsonValue,
	type ObserverErrorInfo,
	type Session,
	type ToolCallContext,
	type ToolExecutionMode,
	type ToolInfo,
	type ToolMiddleware,
	type ToolUpdateCallback,
} from "./core";
// 默认 Agent 与它自带的能力：durable session、compaction、hooks、prompt 组装。
export * from "./harness";
