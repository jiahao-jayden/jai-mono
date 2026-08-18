import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import type { AgentPluginManifestV1 } from "./types";

export interface AgentPluginComponentContext {
	readonly root: string;
	readonly manifest: AgentPluginManifestV1;
}

export interface AgentPluginComponentResult<T> {
	readonly value?: T;
	readonly diagnostics: readonly AgentPluginDiagnostic[];
}

/**
 * 组件适配器是策略接口：Skill 与 MCP 共享包加载骨架，但各自保留协议专属校验与描述。
 */
export interface AgentPluginComponentAdapter<T> {
	readonly kind: "skills" | "mcp" | "hooks";
	load(context: AgentPluginComponentContext): Promise<AgentPluginComponentResult<T>>;
}
