import type { AgentTool } from "@jai/agent";
import type { AgentPluginSkillDescriptor } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";

export interface AgentPluginDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

export interface AgentPluginRuntimeOptions {
	/** 字符串目录保留旧接口，并使用 scope 作为默认作用域。 */
	readonly directories: readonly (string | AgentPluginDirectory)[];
	readonly dataDirectory: string;
	readonly scope?: "user" | "project";
}

export interface AgentPluginRuntime {
	readonly skills: readonly AgentPluginSkillDescriptor[];
	readonly tools: readonly AgentTool[];
	readonly diagnostics: readonly AgentPluginDiagnostic[];
	close(): Promise<void>;
}
