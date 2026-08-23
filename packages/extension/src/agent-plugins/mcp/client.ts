import type { AgentToolResult } from "@jai/agent";
import { type McpToolMetadata, mcpToolPresentation } from "@jai/coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type TSchema, Type } from "@sinclair/typebox";
import { AgentPluginMcpConnectionFailed } from "../package/errors";
import type { AgentPluginMcpServer, AgentPluginMcpTool } from "./types";

interface ConnectedServer {
	readonly client: Client;
	readonly tools: readonly AgentPluginMcpTool[];
}

export async function connectPluginMcp(
	namespace: string,
	servers: readonly AgentPluginMcpServer[],
	signal?: AbortSignal,
): Promise<{
	readonly tools: readonly AgentPluginMcpTool[];
	readonly diagnostics: readonly { readonly serverName: string; readonly message: string }[];
	readonly close: () => Promise<void>;
}> {
	const connected: ConnectedServer[] = [];
	const diagnostics: { serverName: string; message: string }[] = [];
	for (const server of servers) {
		if (signal?.aborted) {
			await closeServers(connected);
			throw new AgentPluginMcpConnectionFailed({ serverName: "<plugin>", message: "MCP connection was aborted" });
		}
		try {
			connected.push(await connectServer(namespace, server, signal));
		} catch (cause) {
			diagnostics.push({
				serverName: server.name,
				message: cause instanceof AgentPluginMcpConnectionFailed ? cause.message : "MCP server connection failed",
			});
		}
	}
	return { tools: connected.flatMap((server) => server.tools), diagnostics, close: () => closeServers(connected) };
}

async function connectServer(
	namespace: string,
	server: AgentPluginMcpServer,
	signal?: AbortSignal,
): Promise<ConnectedServer> {
	const client = new Client({ name: "jai-agent-plugins", version: "0.1.0" });
	try {
		await client.connect(createTransport(server), signal ? { signal } : undefined);
		const listed = await client.listTools(undefined, signal ? { signal } : undefined);
		return { client, tools: listed.tools.map((tool) => createTool(namespace, server.name, client, tool)) };
	} catch (cause) {
		await client.close().catch(() => {});
		throw new AgentPluginMcpConnectionFailed({
			serverName: server.name,
			message: "MCP server connection failed",
			cause,
		});
	}
}

function createTransport(
	server: AgentPluginMcpServer,
): StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport {
	if (server.type === "stdio") {
		return new StdioClientTransport({
			command: server.command,
			args: [...server.args],
			env: { ...server.env },
			...(server.cwd ? { cwd: server.cwd } : {}),
		});
	}
	const headers = { ...server.headers };
	if (server.type === "sse") return new SSEClientTransport(new URL(server.url), { requestInit: { headers } });
	return new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } });
}

function createTool(
	namespace: string,
	serverName: string,
	client: Client,
	tool: McpToolMetadata & { readonly description?: string; readonly inputSchema?: unknown },
): AgentPluginMcpTool {
	return {
		tool: {
			name: `mcp__${sanitize(namespace)}__${sanitize(serverName)}__${sanitize(tool.name)}`,
			description: tool.description?.trim() || `MCP tool ${tool.name} from ${serverName}`,
			parameters: jsonSchemaToTypeBox(tool.inputSchema),
			executionMode: "parallel",
			execute: async (_toolCallId, input, signal): Promise<AgentToolResult> => {
				try {
					const result = await client.callTool(
						{ name: tool.name, arguments: input as Record<string, unknown> },
						undefined,
						signal ? { signal } : undefined,
					);
					if (!("content" in result)) return { content: [{ type: "text", text: JSON.stringify(result) ?? "" }] };
					return { content: mapContent((result as { readonly content?: readonly unknown[] }).content) };
				} catch (cause) {
					throw new AgentPluginMcpConnectionFailed({ serverName, message: `MCP tool "${tool.name}" failed`, cause });
				}
			},
		},
		presentation: mcpToolPresentation(tool),
	};
}

function mapContent(content: readonly unknown[] | undefined): AgentToolResult["content"] {
	if (!content?.length) return [{ type: "text", text: "MCP tool returned no content" }];
	return content.map((item) => {
		if (isRecord(item) && item.type === "text" && typeof item.text === "string")
			return { type: "text" as const, text: item.text };
		if (isRecord(item) && item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string")
			return { type: "image" as const, image: item.data, mimeType: item.mimeType };
		return { type: "text" as const, text: JSON.stringify(item) ?? String(item) };
	});
}

function jsonSchemaToTypeBox(schema: unknown): TSchema {
	if (!isRecord(schema)) return Type.Record(Type.String(), Type.Unknown());
	if (Array.isArray(schema.enum)) {
		const literals = schema.enum.flatMap((value) => literal(value));
		if (literals.length === 1) return literals[0]!;
		if (literals.length > 1) return Type.Union(literals);
	}
	if ("const" in schema) return literal(schema.const)[0] ?? Type.Unknown();
	switch (schema.type) {
		case "object": {
			const properties = isRecord(schema.properties) ? schema.properties : {};
			const required = new Set(
				Array.isArray(schema.required)
					? schema.required.filter((value): value is string => typeof value === "string")
					: [],
			);
			return Type.Object(
				Object.fromEntries(
					Object.entries(properties).map(([key, value]) => [
						key,
						required.has(key) ? jsonSchemaToTypeBox(value) : Type.Optional(jsonSchemaToTypeBox(value)),
					]),
				) as Record<string, TSchema>,
				{ additionalProperties: schema.additionalProperties !== false },
			);
		}
		case "array":
			return Type.Array(jsonSchemaToTypeBox(schema.items));
		case "string":
			return Type.String();
		case "number":
			return Type.Number();
		case "integer":
			return Type.Integer();
		case "boolean":
			return Type.Boolean();
		case "null":
			return Type.Null();
		default:
			return Type.Unknown();
	}
}

function literal(value: unknown): TSchema[] {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return [Type.Literal(value)];
	if (value === null) return [Type.Null()];
	return [];
}

async function closeServers(servers: readonly ConnectedServer[]): Promise<void> {
	for (const server of [...servers].reverse()) await server.client.close().catch(() => {});
}

function sanitize(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]+/g, "_") || "unnamed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
