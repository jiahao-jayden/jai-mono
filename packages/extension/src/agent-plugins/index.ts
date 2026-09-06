import {
	type CodingAgentExtension,
	CodingExtensionOperationFailed,
	type CodingExtensionTool,
	type CodingExtensionToolCatalog,
	type CodingExtensionToolResult,
	defineExtension,
} from "@jai/coding-agent";
import { Result } from "better-result";
import { type AgentPluginDirectory, type AgentPluginRuntime, type AgentPluginRuntimeOptions, activateAgentPlugins, discoverAgentPlugins } from "./runtime";

export type { AgentPluginDirectory };

/** Agent Plugin skill descriptors are inputs for another Extension, never commands themselves. */
export type AgentPluginsExtension = CodingAgentExtension<any, any, AgentPluginRuntime> & {
	readonly skillCards: AgentPluginRuntime["skills"];
};

/**
 * Loads portable Agent Plugins v1 Skills and MCP servers through the public
 * Coding Agent Extension contract.
 */
export async function createAgentPluginsExtension(
	options: AgentPluginRuntimeOptions,
): Promise<AgentPluginsExtension> {
	const discovery = await discoverAgentPlugins(options);
	const extension = defineExtension({
		id: "agent-plugins",
		lifecycle: {
			activate: async () => {
				try {
					return Result.ok(await activateAgentPlugins(discovery, options.dataDirectory));
				} catch (error) {
					return Result.err(
						new CodingExtensionOperationFailed({
							message: error instanceof Error ? error.message : "Agent Plugins activation failed",
							cause: error,
						}),
					);
				}
			},
			deactivate: async (runtime) => runtime.instance.close(),
		},
		catalogs: [
			{
				id: "mcp",
				discover: async (runtime) => Result.ok({ tools: runtime.instance.tools.map(toExtensionTool) }),
			} satisfies CodingExtensionToolCatalog<any, any, AgentPluginRuntime>,
		],
	});
	return { ...extension, skillCards: discovery.skills };
}

export type { AgentPluginSkillDescriptor } from "./package/types";

function toExtensionTool(tool: AgentPluginRuntime["tools"][number]): CodingExtensionTool<any, any, AgentPluginRuntime> {
	const agentTool = tool.tool;
	return {
		name: agentTool.name,
		description: agentTool.description,
		parameters: agentTool.parameters,
		presentation: {
			...(tool.presentation.activityKind ? { activityKind: tool.presentation.activityKind } : {}),
			...(tool.presentation.title ? { title: (_runtime, args) => tool.presentation.title!(args) } : {}),
			...(tool.presentation.resolveActivityKind
				? { resolveActivityKind: (_runtime, args) => tool.presentation.resolveActivityKind!(args) }
				: {}),
		},
		authorization: {
			owner: "core",
			permission: {
				sideEffect: "destructive",
				dataSensitivity: "sensitive",
				reason: `Runs external MCP tool "${agentTool.name}" from an Agent Plugins package.`,
			},
		},
		...(agentTool.executionMode ? { executionMode: agentTool.executionMode } : {}),
		execute: async (_runtime, { toolCallId, args, signal }): Promise<CodingExtensionToolResult> => {
			const result = await agentTool.execute(toolCallId, args, signal);
			return {
				content: result.content,
				...(result.terminate ? { terminate: true } : {}),
			};
		},
	};
}
