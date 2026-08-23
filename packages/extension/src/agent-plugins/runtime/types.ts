import type { AgentPluginSkillDescriptor, LoadedAgentPlugin } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import type { AgentPluginMcpTool } from "../mcp/types";

export interface AgentPluginDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

export interface AgentPluginRuntimeOptions {
	readonly directories: readonly (string | AgentPluginDirectory)[];
	readonly dataDirectory: string;
	readonly scope?: "user" | "project";
}

export interface AgentPluginDiscovery {
	readonly skills: readonly AgentPluginSkillDescriptor[];
	readonly plugins: readonly LoadedAgentPlugin[];
	readonly diagnostics: readonly AgentPluginDiagnostic[];
}

export interface AgentPluginRuntime {
	readonly skills: readonly AgentPluginSkillDescriptor[];
	readonly tools: readonly AgentPluginMcpTool[];
	readonly diagnostics: readonly AgentPluginDiagnostic[];
	close(): Promise<void>;
}
