import {
	CodingExtensionOperationFailed,
	type CodingExtensionDiagnostic,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	type CodingToolCatalogDiscovery,
} from "@jai/coding-agent";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { type TSchema, Type } from "@sinclair/typebox";
import { Result, type Result as ResultType } from "better-result";
import { McpExtensionConnectionFailed, McpExtensionToolCallFailed } from "./errors";
import { mcpToolPresentation } from "./presentation";
import type { McpExtensionConfiguration, McpServer, McpToolMetadata } from "./types";

type McpRemoteTool = McpToolMetadata & {
	readonly description?: string;
	readonly inputSchema?: unknown;
};

interface McpRuntimeOptions {
	readonly extensionId: string;
	readonly catalogId: string;
	readonly namespace: string;
	readonly initialRetryDelayMs: number;
	readonly maxRetryDelayMs: number;
}

/** Owns one session's MCP connections, reconnect timers, descriptors and safe diagnostics. */
export class McpExtensionRuntime {
	readonly #servers: readonly ManagedMcpServer[];
	readonly #diagnostics: CodingExtensionDiagnostic[] = [];
	readonly #invalidators = new Set<() => void>();
	#closed = false;

	constructor(configuration: McpExtensionConfiguration, options: McpRuntimeOptions) {
		this.#servers = Object.values(configuration.servers).map((server) => new ManagedMcpServer(server, options, {
			invalidate: () => this.#invalidate(),
			report: (diagnostic) => this.#diagnostics.push(diagnostic),
		}));
	}

	async start(): Promise<void> {
		await Promise.all(this.#servers.map((server) => server.start()));
	}

	async discover(): Promise<ResultType<CodingToolCatalogDiscovery<McpExtensionConfiguration, {}, McpExtensionRuntime>, CodingExtensionOperationFailed>> {
		const tools: CodingExtensionTool<McpExtensionConfiguration, {}, McpExtensionRuntime>[] = [];
		for (const server of this.#servers) {
			const discovered = await server.discover();
			if (discovered.isErr()) {
				if (server.hasSnapshot) return Result.err(discovered.error);
				continue;
			}
			tools.push(...discovered.value);
		}
		const diagnostics = this.#diagnostics.splice(0, this.#diagnostics.length);
		return Result.ok({ tools, ...(diagnostics.length ? { diagnostics } : {}) });
	}

	subscribe(invalidate: () => void): () => void {
		this.#invalidators.add(invalidate);
		return () => {
			this.#invalidators.delete(invalidate);
		};
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#invalidators.clear();
		await Promise.all(this.#servers.map((server) => server.close()));
	}

	#invalidate(): void {
		if (this.#closed) return;
		for (const invalidate of this.#invalidators) invalidate();
	}
}

interface ManagedMcpServerHost {
	invalidate(): void;
	report(diagnostic: CodingExtensionDiagnostic): void;
}

class ManagedMcpServer {
	readonly #server: McpServer;
	readonly #options: McpRuntimeOptions;
	readonly #host: ManagedMcpServerHost;
	#client?: Client;
	#tools: readonly CodingExtensionTool<McpExtensionConfiguration, {}, McpExtensionRuntime>[] = [];
	#hasSnapshot = false;
	#connecting?: Promise<void>;
	#retryTimer?: ReturnType<typeof setTimeout>;
	#retryAttempt = 0;
	#generation = 0;
	#closed = false;

	constructor(server: McpServer, options: McpRuntimeOptions, host: ManagedMcpServerHost) {
		this.#server = server;
		this.#options = options;
		this.#host = host;
	}

	get hasSnapshot(): boolean {
		return this.#hasSnapshot;
	}

	async start(): Promise<void> {
		await this.#connect();
	}

	async discover(): Promise<ResultType<readonly CodingExtensionTool<McpExtensionConfiguration, {}, McpExtensionRuntime>[], CodingExtensionOperationFailed>> {
		const client = this.#client;
		if (!client) {
			return Result.err(
				new CodingExtensionOperationFailed({ message: `MCP server "${this.#server.name}" is disconnected` }),
			);
		}
		try {
			const listed = await client.listTools();
			this.#tools = listed.tools.map((tool) => this.#createTool(tool));
			this.#hasSnapshot = true;
			return Result.ok(this.#tools);
		} catch (cause) {
			await client.close().catch(() => {});
			return Result.err(
				new CodingExtensionOperationFailed({
					message: `MCP server "${this.#server.name}" tools/list failed`,
					cause,
				}),
			);
		}
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#generation += 1;
		if (this.#retryTimer) clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
		const client = this.#client;
		this.#client = undefined;
		await client?.close().catch(() => {});
	}

	async #connect(): Promise<void> {
		if (this.#closed || this.#connecting) return this.#connecting;
		const generation = ++this.#generation;
		const connection = this.#openConnection(generation).finally(() => {
			if (this.#connecting === connection) this.#connecting = undefined;
		});
		this.#connecting = connection;
		return connection;
	}

	async #openConnection(generation: number): Promise<void> {
		const client = new Client({ name: "jai-mcp-extension", version: "0.1.0" });
		client.onclose = () => this.#handleDisconnect(client, generation);
		client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.#host.invalidate());
		try {
			await client.connect(createTransport(this.#server));
			const listed = await client.listTools();
			if (this.#closed || generation !== this.#generation) {
				await client.close().catch(() => {});
				return;
			}
			const previous = this.#client;
			this.#client = client;
			this.#tools = listed.tools.map((tool) => this.#createTool(tool));
			this.#hasSnapshot = true;
			this.#retryAttempt = 0;
			await previous?.close().catch(() => {});
			this.#host.invalidate();
		} catch (cause) {
			await client.close().catch(() => {});
			if (this.#closed || generation !== this.#generation) return;
			this.#host.report(
				this.#diagnostic(
					new McpExtensionConnectionFailed({
						serverName: this.#server.name,
						message: `MCP server connection failed: ${this.#server.name}`,
						cause,
					}),
				),
			);
			this.#scheduleReconnect();
		}
	}

	#handleDisconnect(client: Client, generation: number): void {
		if (this.#closed || generation !== this.#generation || this.#client !== client) return;
		this.#client = undefined;
		this.#host.report(
			this.#diagnostic(
				new McpExtensionConnectionFailed({
					serverName: this.#server.name,
					message: `MCP server disconnected: ${this.#server.name}`,
				}),
			),
		);
		this.#scheduleReconnect();
	}

	#scheduleReconnect(): void {
		if (this.#closed || this.#retryTimer) return;
		const delay = Math.min(
			this.#options.initialRetryDelayMs * 2 ** this.#retryAttempt,
			this.#options.maxRetryDelayMs,
		);
		this.#retryAttempt += 1;
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined;
			void this.#connect();
		}, delay);
	}

	#createTool(tool: McpRemoteTool): CodingExtensionTool<McpExtensionConfiguration, {}, McpExtensionRuntime> {
		const originalName = tool.name;
		return {
			name: `mcp__${sanitize(this.#options.namespace)}__${sanitize(this.#server.name)}__${sanitize(originalName)}`,
			description: tool.description?.trim() || `MCP tool ${originalName} from ${this.#server.name}`,
			parameters: jsonSchemaToTypeBox(tool.inputSchema),
			executionMode: "parallel",
			authorization: {
				owner: "core",
				permission: { sideEffect: "read", reason: `Calls MCP tool "${originalName}" on ${this.#server.name}.` },
			},
			presentation: mcpToolPresentation(tool),
			execute: async (_runtime, call) => this.#callTool(originalName, call.args, call.signal),
		};
	}

	async #callTool(
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<CodingExtensionToolResult> {
		const client = this.#client;
		if (!client) {
			throw new McpExtensionToolCallFailed({
				serverName: this.#server.name,
				toolName,
				message: `MCP server "${this.#server.name}" is disconnected`,
			});
		}
		try {
			const result = await client.callTool({ name: toolName, arguments: args }, undefined, signal ? { signal } : undefined);
			if (!("content" in result)) {
				return { content: [{ type: "text", text: JSON.stringify(result.toolResult ?? result) ?? "" }] };
			}
			const toolResult = result as { readonly content?: readonly unknown[] };
			return { content: mapMcpContent(toolResult.content) };
		} catch (cause) {
			throw new McpExtensionToolCallFailed({
				serverName: this.#server.name,
				toolName,
				message: `MCP tool "${toolName}" failed`,
				cause,
			});
		}
	}

	#diagnostic(error: McpExtensionConnectionFailed): CodingExtensionDiagnostic {
		return {
			code: error._tag,
			message: error.message,
			extensionId: this.#options.extensionId,
			catalogId: this.#options.catalogId,
		};
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

function mapMcpContent(content: readonly unknown[] | undefined): CodingExtensionToolResult["content"] {
	if (!content?.length) return [{ type: "text", text: "MCP tool returned no content" }];
	const mapped: Array<CodingExtensionToolResult["content"][number]> = [];
	for (const item of content) {
		if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
			mapped.push({ type: "text", text: item.text });
		} else if (isRecord(item) && item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
			mapped.push({ type: "image", image: item.data, mimeType: item.mimeType });
		} else {
			mapped.push({ type: "text", text: JSON.stringify(item) ?? String(item) });
		}
	}
	return mapped;
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
		for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
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
			const switchToGet = response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST");
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
			const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
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
			return Type.String({ ...(typeof schema.minLength === "number" ? { minLength: schema.minLength } : {}), ...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}) });
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
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [Type.Literal(value)];
	if (value === null) return [Type.Null()];
	return [];
}

function sanitize(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]+/g, "_") || "unnamed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
