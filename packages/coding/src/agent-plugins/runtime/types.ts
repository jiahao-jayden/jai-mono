import type { AgentTool } from "@jai/agent";
import type { AgentPluginSkillDescriptor } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";

export interface AgentPluginRuntimeOptions {
	readonly directories: readonly string[];
	readonly dataDirectory: string;
	readonly scope?: "user" | "project";
}

export interface AgentPluginRuntime {
	readonly skills: readonly AgentPluginSkillDescriptor[];
	readonly tools: readonly AgentTool[];
	readonly diagnostics: readonly AgentPluginDiagnostic[];
	close(): Promise<void>;
}
