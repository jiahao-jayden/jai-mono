import type { AgentTool } from "@jai/agent";
import type { AgentPluginSkillDescriptor } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";

export interface AgentPluginDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

export interface AgentPluginRuntimeOptions {
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
