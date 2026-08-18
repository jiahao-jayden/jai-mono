import type { AgentTool, AgentToolResult } from "@jai/agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type TSchema, Type } from "@sinclair/typebox";
import { Result, type Result as ResultType } from "better-result";
import { McpConnectionFailed } from "./errors";
import type { McpConnectOptions, McpDiagnostic, McpRuntime, McpServer } from "./types";

interface ConnectedServer {
	readonly name: string;
	readonly client: Client;
	readonly tools: readonly AgentTool[];
}

export async function connectMcpServers(
	options: McpConnectOptions,
): Promise<ResultType<McpRuntime, McpConnectionFailed>> {
	const diagnostics: McpDiagnostic[] = [];
	const connected: ConnectedServer[] = [];
	if (options.servers.length === 0) return Result.ok(emptyRuntime());
	try {
		for (const server of options.servers) {
			if (options.signal?.aborted) {
				await closeConnectedServers(connected);
				return Result.err(connectionError("<mcp>", "MCP connection was aborted"));
			}
			try {
				connected.push(await connectServer(options.namespace, server, options.signal));
			} catch (cause) {
				diagnostics.push({
					serverName: server.name,
					message: cause instanceof McpConnectionFailed ? cause.message : "MCP server connection failed",
				});
			}
		}
		return Result.ok({
			tools: connected.flatMap((server) => server.tools),
			diagnostics,
			close: () => closeConnectedServers(connected),
		});
	} catch (cause) {
		await closeConnectedServers(connected);
		if (cause instanceof McpConnectionFailed) return Result.err(cause);
		return Result.err(connectionError("<mcp>", "MCP runtime could not be created", cause));
	}
}

function emptyRuntime(): McpRuntime {
	return { tools: [], diagnostics: [], close: async () => {} };
}

async function connectServer(namespace: string, server: McpServer, signal?: AbortSignal): Promise<ConnectedServer> {
	const client = new Client({ name: "jai", version: "0.0.0" });
	try {
		const transport = createTransport(server);
		await client.connect(transport, signal ? { signal } : undefined);
		const listed = await client.listTools(undefined, signal ? { signal } : undefined);
		const tools = listed.tools.map((tool) => createMcpTool(namespace, server.name, client, tool));
		return { name: server.name, client, tools };
	} catch (cause) {
		await client.close().catch(() => {});
		throw connectionError(server.name, "MCP server connection failed", cause);
	}
}

function createTransport(server: McpServer): StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport {
	if (server.type === "stdio") {
		return new StdioClientTransport({
			command: server.command,
			args: [...server.args],
			env: { ...server.env },
			...(server.cwd === undefined ? {} : { cwd: server.cwd }),
		});
	}
	const headers = filterGeneratedHeaders(server.headers);
	if (server.type === "sse") {
		return new SSEClientTransport(new URL(server.url), {
			requestInit: { headers },
			fetch: createRestrictedFetch(headers),
		});
	}
	return new StreamableHTTPClientTransport(new URL(server.url), {
		requestInit: { headers },
		fetch: createRestrictedFetch(headers),
	});
}

function createMcpTool(
	namespace: string,
	serverName: string,
	client: Client,
	tool: { name: string; description?: string; inputSchema?: unknown },
): AgentTool {
	const name = `mcp__${sanitize(namespace)}__${sanitize(serverName)}__${sanitize(tool.name)}`;
	const parameters = jsonSchemaToTypeBox(tool.inputSchema);
	return {
		name,
		description: tool.description?.trim() || `MCP tool ${tool.name} from ${serverName}`,
		parameters,
		executionMode: "parallel",
		execute: async (_toolCallId, input, signal): Promise<AgentToolResult> => {
			try {
				const result = await client.callTool(
					{ name: tool.name, arguments: input as Record<string, unknown> },
					undefined,
					signal ? { signal } : undefined,
				);
				if (!("content" in result)) {
					return { content: [{ type: "text", text: JSON.stringify(result.toolResult ?? result) ?? "" }] };
				}
				const toolResult = result as {
					readonly content?: readonly unknown[];
					readonly structuredContent?: Record<string, unknown>;
				};
				return {
					content: mapMcpContent(toolResult.content),
					...(toolResult.structuredContent ? { details: toolResult.structuredContent } : {}),
				};
			} catch (cause) {
				throw connectionError(serverName, `MCP tool "${tool.name}" failed`, cause);
			}
		},
	};
}

function mapMcpContent(content: readonly unknown[] | undefined): AgentToolResult["content"] {
	if (!content || content.length === 0) return [{ type: "text", text: "MCP tool returned no content" }];
	const mapped: AgentToolResult["content"] = [];
	for (const item of content) {
		if (!isRecord(item)) {
			mapped.push({ type: "text", text: JSON.stringify(item) ?? String(item) });
			continue;
		}
		if (item.type === "text" && typeof item.text === "string") {
			mapped.push({ type: "text", text: item.text });
			continue;
		}
		if (item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
			mapped.push({ type: "image", image: item.data, mimeType: item.mimeType });
			continue;
		}
		mapped.push({ type: "text", text: JSON.stringify(item) ?? String(item) });
	}
	return mapped;
}

async function closeConnectedServers(servers: readonly ConnectedServer[]): Promise<void> {
	for (const server of servers.toReversed()) await server.client.close().catch(() => {});
}

function filterGeneratedHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
	const generated = new Set(["authorization", "mcp-session-id", "mcp-protocol-version"]);
	return Object.fromEntries(Object.entries(headers).filter(([key]) => !generated.has(key.toLowerCase())));
}

function createRestrictedFetch(
	configuredHeaders: Readonly<Record<string, string>>,
): (input: string | URL, init?: RequestInit) => Promise<Response> {
	const configuredNames = new Set(Object.keys(configuredHeaders).map((key) => key.toLowerCase()));
	const crossOriginSensitiveNames = new Set([
		...configuredNames,
		"authorization",
		"cookie",
		"mcp-session-id",
		"mcp-protocol-version",
		"proxy-authorization",
	]);
	return async (input, init) => {
		let currentUrl = new URL(input.toString());
		let currentInit: RequestInit = { ...(init ?? {}), redirect: "manual" };
		for (let redirectCount = 0; redirectCount <= 10; redirectCount++) {
			const response = await fetch(currentUrl, currentInit);
			const location = response.headers.get("location");
			if (!location || ![301, 302, 303, 307, 308].includes(response.status)) return response;
			if (redirectCount === 10) throw new TypeError("MCP HTTP redirect limit exceeded");
			await response.body?.cancel().catch(() => {});
			const nextUrl = new URL(location, currentUrl);
			const headers = new Headers(currentInit.headers);
			if (nextUrl.origin !== currentUrl.origin) {
				for (const name of crossOriginSensitiveNames) headers.delete(name);
			}
			const method = (currentInit.method ?? "GET").toUpperCase();
			const switchToGet =
				response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST");
			currentInit = {
				...currentInit,
				...(switchToGet ? { method: "GET", body: undefined } : {}),
				headers,
				redirect: "manual",
			};
			currentUrl = nextUrl;
		}
		throw new TypeError("MCP HTTP redirect handling did not terminate");
	};
}

function jsonSchemaToTypeBox(schema: unknown): TSchema {
	if (!isRecord(schema)) return Type.Record(Type.String(), Type.Unknown());
	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const literals = schema.enum.flatMap((value) => literalSchema(value));
		if (literals.length === 1) return literals[0]!;
		if (literals.length > 1) return Type.Union(literals);
	}
	if ("const" in schema) return literalSchema(schema.const)[0] ?? Type.Unknown();
	if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
		const variants = ((Array.isArray(schema.anyOf) ? schema.anyOf : schema.oneOf) as unknown[]).map((value) =>
			jsonSchemaToTypeBox(value),
		);
		if (variants.length === 1) return variants[0]!;
		if (variants.length > 1) return Type.Union(variants);
	}
	switch (schema.type) {
		case "object": {
			const properties = isRecord(schema.properties) ? schema.properties : {};
			const required = new Set(
				Array.isArray(schema.required)
					? schema.required.filter((value): value is string => typeof value === "string")
					: [],
			);
			const mapped = Object.fromEntries(
				Object.entries(properties).map(([key, value]) => [
					key,
					required.has(key) ? jsonSchemaToTypeBox(value) : Type.Optional(jsonSchemaToTypeBox(value)),
				]),
			) as Record<string, TSchema>;
			return Type.Object(mapped, { additionalProperties: schema.additionalProperties !== false });
		}
		case "array":
			return Type.Array(jsonSchemaToTypeBox(schema.items));
		case "string":
			return Type.String({
				...(typeof schema.minLength === "number" ? { minLength: schema.minLength } : {}),
				...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}),
			});
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

function literalSchema(value: unknown): TSchema[] {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return [Type.Literal(value)];
	if (value === null) return [Type.Null()];
	return [];
}

function sanitize(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9_-]+/g, "_");
	return normalized || "unnamed";
}

function connectionError(serverName: string, message: string, cause?: unknown): McpConnectionFailed {
	return new McpConnectionFailed({ serverName, message, ...(cause === undefined ? {} : { cause }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
