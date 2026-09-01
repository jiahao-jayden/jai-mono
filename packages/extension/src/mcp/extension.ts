import {
	type CodingAgentExtension,
	type CodingExtensionConfigurationLayers,
	CodingExtensionOperationFailed,
	defineExtension,
} from "@jai/coding-agent";
import { Type } from "@sinclair/typebox";
import { Result, type Result as ResultType } from "better-result";
import { McpExtensionRuntime } from "./runtime";
import type { McpExtensionConfiguration, McpExtensionOptions, McpServer } from "./types";

const DEFAULT_INITIAL_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const CATALOG_ID = "tools";

const rawStdioServerSchema = Type.Object(
	{
		type: Type.Literal("stdio"),
		command: Type.String({ minLength: 1 }),
		args: Type.Optional(Type.Array(Type.String())),
		env: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
		cwd: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
const rawHttpServerSchema = Type.Object(
	{
		type: Type.Literal("streamable-http"),
		url: Type.String({ minLength: 1 }),
		headers: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
	},
	{ additionalProperties: false },
);
const rawSseServerSchema = Type.Object(
	{
		type: Type.Literal("sse"),
		url: Type.String({ minLength: 1 }),
		headers: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
	},
	{ additionalProperties: false },
);
const rawServerSchema = Type.Union([rawStdioServerSchema, rawHttpServerSchema, rawSseServerSchema]);
const rawConfigurationSchema = Type.Object(
	{ servers: Type.Optional(Type.Record(Type.String({ minLength: 1 }), rawServerSchema)) },
	{ additionalProperties: false },
);
const resolvedStdioServerSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		type: Type.Literal("stdio"),
		command: Type.String({ minLength: 1 }),
		args: Type.Array(Type.String()),
		env: Type.Record(Type.String({ minLength: 1 }), Type.String()),
		cwd: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);
const resolvedHttpServerSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		type: Type.Literal("streamable-http"),
		url: Type.String({ minLength: 1 }),
		headers: Type.Record(Type.String({ minLength: 1 }), Type.String()),
	},
	{ additionalProperties: false },
);
const resolvedSseServerSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		type: Type.Literal("sse"),
		url: Type.String({ minLength: 1 }),
		headers: Type.Record(Type.String({ minLength: 1 }), Type.String()),
	},
	{ additionalProperties: false },
);
const resolvedConfigurationSchema = Type.Object(
	{
		servers: Type.Record(
			Type.String({ minLength: 1 }),
			Type.Union([resolvedStdioServerSchema, resolvedHttpServerSchema, resolvedSseServerSchema]),
		),
	},
	{ additionalProperties: false },
);

/** Creates the official MCP capability provider. Host code only installs this Extension. */
export function createMcpExtension(
	options: McpExtensionOptions = {},
): CodingAgentExtension<McpExtensionConfiguration, {}, McpExtensionRuntime> {
	const id = options.id ?? "mcp";
	const namespace = options.namespace ?? "mcp";
	const initialRetryDelayMs = positiveDelay(options.initialRetryDelayMs, DEFAULT_INITIAL_RETRY_DELAY_MS);
	const maxRetryDelayMs = Math.max(
		initialRetryDelayMs,
		positiveDelay(options.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS),
	);
	return defineExtension({
		id,
		configuration: {
			scope: "layered",
			layerSchema: rawConfigurationSchema,
			schema: resolvedConfigurationSchema,
			defaultValue: { servers: {} },
			resolve: resolveMcpConfiguration,
		},
		catalogs: [
			{
				id: CATALOG_ID,
				discover: (runtime) => runtime.instance.discover(),
				subscribe: (runtime, invalidate) => runtime.instance.subscribe(invalidate),
			},
		],
		lifecycle: {
			activate: async (context) => {
				const runtime = new McpExtensionRuntime(context.configuration.value, {
					extensionId: id,
					catalogId: CATALOG_ID,
					namespace,
					initialRetryDelayMs,
					maxRetryDelayMs,
				});
				await runtime.start();
				return Result.ok(runtime);
			},
			deactivate: (runtime) => runtime.instance.close(),
		},
	});
}

/** Project replaces a user server with the same name; it never deep-merges a server entry. */
export function resolveMcpConfiguration(
	layers: CodingExtensionConfigurationLayers,
): ResultType<McpExtensionConfiguration, CodingExtensionOperationFailed> {
	const rawServers = {
		...serverRecords(layers.user),
		...serverRecords(layers.project),
	};
	const servers: Record<string, McpServer> = {};
	for (const [name, value] of Object.entries(rawServers)) {
		const resolved = resolveServer(name, value);
		if (resolved.isErr()) return resolved;
		servers[name] = resolved.value;
	}
	return Result.ok({ servers });
}

function serverRecords(layer: Record<string, unknown> | undefined): Record<string, unknown> {
	const servers = layer?.servers;
	return isRecord(servers) ? servers : {};
}

function resolveServer(name: string, value: unknown): ResultType<McpServer, CodingExtensionOperationFailed> {
	if (!name.trim() || !isRecord(value) || typeof value.type !== "string") {
		return Result.err(new CodingExtensionOperationFailed({ message: `MCP server "${name}" is invalid` }));
	}
	if (value.type === "stdio") {
		if (typeof value.command !== "string" || !value.command.trim()) {
			return Result.err(
				new CodingExtensionOperationFailed({ message: `MCP stdio server "${name}" requires a command` }),
			);
		}
		const args = stringArray(value.args);
		const env = stringRecord(value.env);
		if (!args || !env || (value.cwd !== undefined && (typeof value.cwd !== "string" || !value.cwd.trim()))) {
			return Result.err(
				new CodingExtensionOperationFailed({ message: `MCP stdio server "${name}" has invalid options` }),
			);
		}
		return Result.ok({
			name,
			type: "stdio",
			command: value.command,
			args,
			env,
			...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
		});
	}
	if (value.type === "streamable-http" || value.type === "sse") {
		if (typeof value.url !== "string" || !isAllowedRemoteUrl(value.url)) {
			return Result.err(
				new CodingExtensionOperationFailed({ message: `MCP ${value.type} server "${name}" has an invalid URL` }),
			);
		}
		const headers = stringRecord(value.headers);
		if (!headers)
			return Result.err(new CodingExtensionOperationFailed({ message: `MCP server "${name}" has invalid headers` }));
		return Result.ok({ name, type: value.type, url: value.url, headers });
	}
	return Result.err(
		new CodingExtensionOperationFailed({ message: `MCP server "${name}" has unsupported transport "${value.type}"` }),
	);
}

function positiveDelay(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function stringArray(value: unknown): string[] | undefined {
	if (value === undefined) return [];
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (value === undefined) return {};
	if (!isRecord(value) || !Object.values(value).every((item) => typeof item === "string")) return undefined;
	return value as Record<string, string>;
}

function isAllowedRemoteUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.username || url.password) return false;
		return (
			url.protocol === "https:" ||
			(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
		);
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
