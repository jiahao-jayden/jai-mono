import type { CodingPluginSkillCard } from "../../skills/catalog";
import type { AgentPluginMcpServer } from "../mcp/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";

export const AGENT_PLUGINS_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" as const;

export interface AgentPluginManifestV1 {
	readonly $schema: typeof AGENT_PLUGINS_SCHEMA;
	readonly name: string;
	readonly version?: string;
	readonly description?: string;
	readonly author?: Readonly<{ name?: string; email?: string; url?: string }>;
	readonly homepage?: string;
	readonly repository?: string;
	readonly license?: string;
	readonly keywords?: readonly string[];
	readonly extensions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface AgentPluginSkillDescriptor extends CodingPluginSkillCard {
	readonly source: Extract<CodingPluginSkillCard["source"], { readonly directory: "plugin" }>;
}

export interface LoadedAgentPlugin {
	readonly protocolVersion: "1.0.0";
	readonly root: string;
	readonly manifest: AgentPluginManifestV1;
	readonly skills: readonly AgentPluginSkillDescriptor[];
	readonly mcpServers: readonly AgentPluginMcpServer[];
	readonly diagnostics: readonly AgentPluginDiagnostic[];
}

export type { AgentPluginMcpServer } from "../mcp/types";
export type { AgentPluginDiagnostic } from "../shared/diagnostics";
