import path from "node:path";
import { connectAgentPluginMcp } from "../mcp/runtime";
import type { AgentPluginMcpRuntime } from "../mcp/types";
import { loadAgentPluginDirectory } from "../package/loader";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import type { AgentPluginDiscovery, AgentPluginRuntime, AgentPluginRuntimeOptions } from "./types";

export async function discoverAgentPlugins(options: AgentPluginRuntimeOptions): Promise<AgentPluginDiscovery> {
	const skills: AgentPluginDiscovery["skills"][number][] = [];
	const plugins: AgentPluginDiscovery["plugins"][number][] = [];
	const diagnostics: AgentPluginDiagnostic[] = [];
	for (const entry of options.directories) {
		const directory = typeof entry === "string" ? { path: entry, scope: options.scope ?? "user" } : entry;
		const loaded = await loadAgentPluginDirectory(directory.path, { scope: directory.scope });
		if (loaded.isErr()) {
			diagnostics.push({
				code: "plugin_load_failed",
				severity: "error",
				scope: "package",
				relativePath: path.basename(directory.path),
				message: loaded.error.message,
			});
			continue;
		}
		const plugin = loaded.value;
		plugins.push(plugin);
		skills.push(...plugin.skills);
		diagnostics.push(...plugin.diagnostics);
	}
	return { skills, plugins, diagnostics };
}

export async function activateAgentPlugins(
	discovery: AgentPluginDiscovery,
	dataDirectory: string,
): Promise<AgentPluginRuntime> {
	const tools: AgentPluginRuntime["tools"][number][] = [];
	const diagnostics: AgentPluginDiagnostic[] = [...discovery.diagnostics];
	const mcpRuntimes: AgentPluginMcpRuntime[] = [];
	for (const plugin of discovery.plugins) {
		const pluginDataDirectory = path.join(dataDirectory, plugin.manifest.name);
		const mcp = await connectAgentPluginMcp(plugin, {
			pluginDataDirectory,
		});
		if (mcp.isErr()) {
			diagnostics.push({
				code: "plugin_mcp_runtime_failed",
				severity: "error",
				scope: "mcp",
				message: mcp.error.message,
			});
		} else {
			mcpRuntimes.push(mcp.value);
			tools.push(...mcp.value.tools);
			diagnostics.push(...mcp.value.diagnostics);
		}
	}
	return {
		skills: discovery.skills,
		tools,
		diagnostics,
		close: async () => {
			for (const runtime of mcpRuntimes.toReversed()) await runtime.close();
		},
	};
}

export type { AgentPluginDirectory, AgentPluginDiscovery, AgentPluginRuntime, AgentPluginRuntimeOptions } from "./types";
