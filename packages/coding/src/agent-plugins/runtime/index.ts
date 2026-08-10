import path from "node:path";
import type { AgentHookMap, AgentTool } from "@jai/agent";
import { connectAgentPluginHooks } from "../hooks/runtime";
import type { AgentPluginHookRuntime, AgentPluginHookRuntimeOptions } from "../hooks/types";
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
	const hookRuntimes: AgentPluginHookRuntime[] = [];
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
		skills.push(...plugin.skills);
		diagnostics.push(...plugin.diagnostics);
		const pluginDataDirectory = path.join(options.dataDirectory, plugin.manifest.name);
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
		const hooks = await connectAgentPluginHooks(plugin, { pluginDataDirectory });
		if (hooks.isErr()) {
			diagnostics.push({
				code: "plugin_hooks_runtime_failed",
				severity: "error",
				scope: "hooks",
				message: hooks.error.message,
			});
		} else {
			hookRuntimes.push(hooks.value);
		}
	}
	return {
		skills,
		tools,
		diagnostics,
		createHooks: (options) => mergeHookMaps(hookRuntimes, options, diagnostics),
		close: async () => {
			for (const runtime of mcpRuntimes.toReversed()) await runtime.close();
		},
	};
}

function mergeHookMaps(
	runtimes: readonly AgentPluginHookRuntime[],
	options: AgentPluginHookRuntimeOptions,
	diagnostics: AgentPluginDiagnostic[],
): AgentHookMap {
	const hookMaps = runtimes.map((runtime) =>
		runtime.createHooks(options, (diagnostic) => diagnostics.push(diagnostic)),
	);
	const aroundToolCall = hookMaps.flatMap((hooks) => hooks.aroundToolCall ?? []);
	const onEvent = hookMaps.flatMap((hooks) => hooks.onEvent ?? []);
	return {
		...(aroundToolCall.length > 0 ? { aroundToolCall } : {}),
		...(onEvent.length > 0 ? { onEvent } : {}),
	};
}

export type { AgentPluginDirectory, AgentPluginRuntime, AgentPluginRuntimeOptions } from "./types";
