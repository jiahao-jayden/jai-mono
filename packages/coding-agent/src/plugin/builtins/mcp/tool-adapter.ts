import type { AgentTool } from "@jayden/jai-agent";
import type { JSONSchema7 } from "@jayden/jai-ai";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema, type Tool as McpToolDef } from "@modelcontextprotocol/sdk/types.js";

const PREFIX = "mcp__";

/** 把 MCP server 名 + tool 名编码进 AgentTool name。 */
export function buildMcpToolName(serverName: string, toolName: string): string {
	return `${PREFIX}${serverName}__${toolName}`;
}

/** 反向解析。LLM 调用 `mcp__linear__list_issues` → { server: "linear", tool: "list_issues" } */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
	if (!name.startsWith(PREFIX)) return null;
	const rest = name.slice(PREFIX.length);
	const sep = rest.indexOf("__");
	if (sep === -1) return null;
	return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

/** MCP tool → AgentTool. inputSchema 直接当 JSON Schema 7 走 ai SDK 的 jsonSchema()。 */
export function mcpToolToAgentTool(opts: {
	serverName: string;
	mcpTool: McpToolDef;
	client: Client;
	timeout: number;
}): AgentTool {
	const { serverName, mcpTool, client, timeout } = opts;

	const inputSchema = mcpTool.inputSchema as JSONSchema7 | undefined;
	const normalized: JSONSchema7 = {
		...(inputSchema ?? {}),
		type: "object",
		properties: (inputSchema?.properties ?? {}) as JSONSchema7["properties"],
		additionalProperties: false,
	};

	const fullName = buildMcpToolName(serverName, mcpTool.name);

	return {
		name: fullName,
		label: mcpTool.name,
		description: mcpTool.description ?? `MCP tool from ${serverName}`,
		parameters: normalized,
		async execute(args, signal) {
			if (signal?.aborted) {
				throw new Error("aborted");
			}
			const result = await client.callTool(
				{
					name: mcpTool.name,
					arguments: (args ?? {}) as Record<string, unknown>,
				},
				CallToolResultSchema,
				{
					resetTimeoutOnProgress: true,
					timeout,
					signal,
				},
			);
			return {
				content: (result.content as { type: string; text?: string; data?: string; mimeType?: string }[])
					.map((c) => normalizeMcpContent(c))
					.filter((c): c is NonNullable<typeof c> => c !== null),
				isError: result.isError ?? false,
			};
		},
	} as AgentTool;
}

function normalizeMcpContent(
	c: { type: string; text?: string; data?: string; mimeType?: string },
): { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | null {
	if (c.type === "text" && typeof c.text === "string") {
		return { type: "text", text: c.text };
	}
	if (c.type === "image" && typeof c.data === "string" && typeof c.mimeType === "string") {
		return { type: "image", data: c.data, mimeType: c.mimeType };
	}
	return null;
}
