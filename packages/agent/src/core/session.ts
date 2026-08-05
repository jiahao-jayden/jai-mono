import type { ProviderErrorInfo } from "@jai/ai";
import type { JsonObject } from "./agent-state";
import type { AgentMessage, AgentTool } from "./types";

/**
 * 工具的 wire-safe 元信息：只暴露展示所需字段，不含 execute 与 schema。
 * 快照与远程客户端都只看到这一层，execute 永远留在运行侧。
 */
export interface ToolInfo {
	name: string;
	description: string;
}

/** 一段对话的 wire-safe 状态，可用于渲染、持久化与恢复。 */
export interface Session<TAppState extends JsonObject = JsonObject> {
	systemPrompt: string;
	messages: AgentMessage[];
	appState: TAppState;
	tools: ToolInfo[];

	isRunning: boolean;
	streamingMessage?: AgentMessage;
	pendingToolCallIds: readonly string[];
	error?: ProviderErrorInfo;
}

export function toToolInfo(tool: AgentTool): ToolInfo {
	return {
		name: tool.name,
		description: tool.description,
	};
}
