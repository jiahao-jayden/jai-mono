import type { AgentTool } from "@jai/agent";
import {
	type CodingAgentExtension,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	defineExtension,
} from "@jai/coding-agent";
import { createAgentPluginRuntime } from "./runtime";

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
export function createAgentPluginsExtension(options: AgentPluginsExtensionOptions): CodingAgentExtension {
	return defineExtension({
		id: "agent-plugins",
		initialize: async () => {
			const runtime = await createAgentPluginRuntime(options);
			const tools = runtime.tools.map(toExtensionTool);
			return {
				tools,
				skills: runtime.skills,
				dispose: () => runtime.close(),
			};
		},
	});
}

function toExtensionTool(tool: AgentTool): CodingExtensionTool {
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
		...(tool.title ? { title: (args) => tool.title!(args) } : {}),
		...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
		execute: async ({ toolCallId, args, signal }): Promise<CodingExtensionToolResult> => {
			const result = await tool.execute(toolCallId, args, signal);
			return {
				content: result.content,
				...(result.terminate ? { terminate: true } : {}),
			};
		},
	};
}
