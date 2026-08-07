import path from "node:path";
import type { AgentTool } from "@jai/agent";
import { connectAgentPluginMcp } from "../mcp/runtime";
import type { AgentPluginMcpRuntime } from "../mcp/types";
import { loadAgentPluginDirectory } from "../package/loader";
import type { AgentPluginSkillDescriptor } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import type { AgentPluginRuntime, AgentPluginRuntimeOptions } from "./types";

export async function createAgentPluginRuntime(options: AgentPluginRuntimeOptions): Promise<AgentPluginRuntime> {
	const skills: AgentPluginSkillDescriptor[] = [];
	const tools: AgentTool[] = [];
	const diagnostics: AgentPluginDiagnostic[] = [];
	const mcpRuntimes: AgentPluginMcpRuntime[] = [];
	for (const directory of options.directories) {
		const loaded = await loadAgentPluginDirectory(directory, { scope: options.scope ?? "user" });
		if (loaded.isErr()) {
			diagnostics.push({
				code: "plugin_load_failed",
				severity: "error",
				scope: "package",
				relativePath: path.basename(directory),
				message: loaded.error.message,
			});
			continue;
		}
		const plugin = loaded.value;
		skills.push(...plugin.skills);
		diagnostics.push(...plugin.diagnostics);
		const mcp = await connectAgentPluginMcp(plugin, {
			pluginDataDirectory: path.join(options.dataDirectory, plugin.manifest.name),
		});
		if (mcp.isErr()) {
			diagnostics.push({
				code: "plugin_mcp_runtime_failed",
				severity: "error",
				scope: "mcp",
				message: mcp.error.message,
			});
			continue;
		}
		mcpRuntimes.push(mcp.value);
		tools.push(...mcp.value.tools);
		diagnostics.push(...mcp.value.diagnostics);
	}
	return {
		skills,
		tools,
		diagnostics,
		close: async () => {
			for (const runtime of mcpRuntimes.toReversed()) await runtime.close();
		},
	};
}

export type { AgentPluginRuntime, AgentPluginRuntimeOptions } from "./types";
