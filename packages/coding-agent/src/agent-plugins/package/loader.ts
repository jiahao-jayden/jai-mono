import { Result, type Result as ResultType } from "better-result";
import { hooksComponentAdapter } from "../hooks/adapter";
import type { AgentPluginHooksDescriptor } from "../hooks/types";
import { mcpComponentAdapter } from "../mcp/adapter";
import type { AgentPluginMcpServer } from "../mcp/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import { skillComponentAdapter } from "../skills/adapter";
import { AgentPluginLoadFailed } from "./errors";
import { readManifest } from "./manifest";
import { resolvePluginRoot } from "./paths";
import type { AgentPluginSkillDescriptor, LoadedAgentPlugin } from "./types";

const componentAdapters = [skillComponentAdapter, mcpComponentAdapter, hooksComponentAdapter] as const;

export interface AgentPluginLoadOptions {
	readonly scope?: "user" | "project";
}

export async function loadAgentPluginDirectory(
	directory: string,
	options: AgentPluginLoadOptions = {},
): Promise<ResultType<LoadedAgentPlugin, AgentPluginLoadFailed>> {
	try {
		const root = await resolvePluginRoot(directory);
		const manifestResult = await readManifest(root);
		const manifest = manifestResult.manifest;
		const context = { root, manifest };
		const diagnostics: AgentPluginDiagnostic[] = [...manifestResult.diagnostics];
		let skills: readonly AgentPluginSkillDescriptor[] = [];
		let mcpServers: readonly AgentPluginMcpServer[] = [];
		let hooks: readonly AgentPluginHooksDescriptor[] = [];
		for (const adapter of componentAdapters) {
			try {
				const result = await adapter.load(context);
				diagnostics.push(...result.diagnostics);
				if (adapter.kind === "skills") skills = (result.value ?? []) as readonly AgentPluginSkillDescriptor[];
				if (adapter.kind === "mcp") mcpServers = (result.value ?? []) as readonly AgentPluginMcpServer[];
				if (adapter.kind === "hooks") hooks = (result.value ?? []) as readonly AgentPluginHooksDescriptor[];
			} catch (cause) {
				diagnostics.push({
					code: `plugin_${adapter.kind}_failed`,
					severity: "error",
					scope: adapter.kind,
					message: cause instanceof Error ? cause.message : `Plugin ${adapter.kind} component could not be loaded`,
				});
			}
		}
		if (options.scope === "project") {
			skills = skills.map((skill) => ({ ...skill, source: { ...skill.source, scope: "project" } }));
		}
		return Result.ok({ protocolVersion: "1.0.0", root, manifest, skills, mcpServers, hooks, diagnostics });
	} catch (cause) {
		if (isAgentPluginLoadFailed(cause)) return Result.err(cause);
		return Result.err(
			new AgentPluginLoadFailed({ reason: "root_unavailable", message: "Agent Plugin could not be loaded", cause }),
		);
	}
}

function isAgentPluginLoadFailed(value: unknown): value is AgentPluginLoadFailed {
	return (
		typeof value === "object" && value !== null && "_tag" in value && value._tag === "coding_agent_plugin.load_failed"
	);
}
