import {
	type CodingAgentExtension,
	type CodingExtensionToolCatalog,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	CodingExtensionOperationFailed,
	defineExtension,
} from "@jai/coding-agent";
import { Result } from "better-result";
import { activateAgentPlugins, discoverAgentPlugins, type AgentPluginRuntime } from "./runtime";

export interface AgentPluginsDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

export interface AgentPluginsExtensionOptions {
	readonly directories: readonly (string | AgentPluginsDirectory)[];
	readonly dataDirectory: string;
	readonly scope?: "user" | "project";
}

/**
 * Loads portable Agent Plugins v1 Skills and MCP servers through the public
 * Coding Agent Extension contract.
 */
export async function createAgentPluginsExtension(
	options: AgentPluginsExtensionOptions,
): Promise<CodingAgentExtension<any, any, AgentPluginRuntime>> {
	const discovery = await discoverAgentPlugins(options);
	return defineExtension({
		id: "agent-plugins",
		skills: discovery.skills,
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
}

function toExtensionTool(tool: AgentPluginRuntime["tools"][number]): CodingExtensionTool<any, any, AgentPluginRuntime> {
	return {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		authorization: {
			owner: "core",
			permission: {
				sideEffect: "destructive",
				dataSensitivity: "sensitive",
				reason: `Runs external MCP tool "${tool.name}" from an Agent Plugins package.`,
			},
		},
		...(tool.title ? { title: (_runtime, args) => tool.title!(args) } : {}),
		...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
		execute: async (_runtime, { toolCallId, args, signal }): Promise<CodingExtensionToolResult> => {
			const result = await tool.execute(toolCallId, args, signal);
			return {
				content: result.content,
				...(result.terminate ? { terminate: true } : {}),
			};
		},
	};
}
