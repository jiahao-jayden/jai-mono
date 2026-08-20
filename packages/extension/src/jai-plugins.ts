import type { AgentTool, AgentToolResult, ToolCallContext } from "@jai/agent";
import {
	type CodingAgentExtension,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	defineExtension,
	type JsonObject,
} from "@jai/coding-agent";
import { Type } from "@sinclair/typebox";
import { createAgentPluginRuntime } from "./jai-plugins/runtime";

export interface JaiPluginsDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

export interface JaiPluginsExtensionOptions {
	readonly directories: readonly (string | JaiPluginsDirectory)[];
	readonly dataDirectory: string;
	readonly scope?: "user" | "project";
}

/**
 * Loads Agent Plugins through the public Coding Agent Extension contract.
 * Plugin MCP servers, Skills and hook commands are fully owned by this
 * extension; the core SDK only sees declared capabilities.
 */
export function createJaiPluginsExtension(options: JaiPluginsExtensionOptions): CodingAgentExtension {
	return defineExtension({
		id: "jai-plugins",
		initialize: async (extensionContext) => {
			const runtime = await createAgentPluginRuntime(options);
			const hookOptions = {
				sessionId: extensionContext.sessionId,
				agentKind: "primary" as const,
				workspaceDirectory: extensionContext.cwd,
			};
			const toolsByName = new Map(runtime.tools.map((tool) => [tool.name, tool]));
			const tools = runtime.tools.map(toExtensionTool);
			return {
				tools,
				skills: runtime.skills,
				hooks: {
					sessionStart: () => runtime.sessionStart(hookOptions),
					beforeToolCall: async (input) => {
						const context = toolCallContext(
							input.toolCallId,
							input.toolName,
							input.args,
							toolsByName.get(input.toolName),
						);
						const result = await runtime.beforeToolCall(context, hookOptions);
						if (result.status === "deny") return { kind: "block" as const, reason: result.reason };
						return { kind: "continue" as const, args: result.input as JsonObject };
					},
					afterToolCall: async (input) => {
						const context = toolCallContext(
							input.toolCallId,
							input.toolName,
							input.args,
							toolsByName.get(input.toolName),
						);
						await runtime.afterToolCall(context, input.result as AgentToolResult, input.isError, hookOptions);
					},
				},
				dispose: async () => {
					await runtime.close();
				},
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
				reason: `Runs external MCP tool "${tool.name}" from an Agent Plugin.`,
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

function toolCallContext(
	toolCallId: string,
	toolName: string,
	args: JsonObject,
	tool: AgentTool | undefined,
): ToolCallContext {
	return {
		toolCall: { type: "toolCall", id: toolCallId, name: toolName, arguments: { ...args } },
		tool: tool ?? {
			name: toolName,
			description: toolName,
			parameters: Type.Record(Type.String(), Type.Unknown()),
			execute: async () => ({ content: [] }),
		},
		args: { ...args },
	};
}
