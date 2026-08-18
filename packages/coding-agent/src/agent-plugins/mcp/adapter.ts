import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TaggedError } from "better-result";
import type {
	AgentPluginComponentAdapter,
	AgentPluginComponentContext,
	AgentPluginComponentResult,
} from "../package/component";
import { isInside } from "../package/paths";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import {
	AGENT_PLUGINS_MCP_SCHEMA,
	type AgentPluginHttpServer,
	type AgentPluginMcpServer,
	type AgentPluginSseServer,
	type AgentPluginStdioServer,
} from "./types";

const STDIO_KEYS = new Set(["type", "command", "args", "env", "cwd"]);
const HTTP_KEYS = new Set(["type", "url", "headers"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PLUGIN_ROOT_PLACEHOLDER = ["$", "{PLUGIN_ROOT}"].join("");
const PLUGIN_DATA_PLACEHOLDER = ["$", "{PLUGIN_DATA}"].join("");

class InvalidPluginMcpServer extends TaggedError("coding_agent_plugin.invalid_mcp_server")<{
	readonly message: string;
}> {}

export const mcpComponentAdapter: AgentPluginComponentAdapter<readonly AgentPluginMcpServer[]> = {
	kind: "mcp",
	load: discoverPluginMcp,
};

async function discoverPluginMcp(
	context: AgentPluginComponentContext,
): Promise<AgentPluginComponentResult<readonly AgentPluginMcpServer[]>> {
	const diagnostics: AgentPluginDiagnostic[] = [];
	const location = path.join(context.root, "mcp.json");
	const canonical = await realpath(location).catch((error) => {
		if (isNodeError(error, "ENOENT")) return undefined;
		diagnostics.push(mcpDiagnostic("plugin_mcp_path_invalid", "mcp", "mcp.json cannot be resolved"));
		return undefined;
	});
	if (!canonical) return { value: [], diagnostics };
	if (!isInside(canonical, context.root)) {
		diagnostics.push(mcpDiagnostic("plugin_mcp_path_escape", "mcp", "mcp.json escapes Plugin root"));
		return { value: [], diagnostics };
	}
	const info = await stat(canonical).catch(() => undefined);
	if (!info?.isFile()) {
		diagnostics.push(mcpDiagnostic("plugin_mcp_path_invalid", "mcp", "mcp.json must be a regular file"));
		return { value: [], diagnostics };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(canonical, "utf8"));
	} catch {
		diagnostics.push(mcpDiagnostic("plugin_mcp_invalid_config", "mcp", "mcp.json is invalid JSON"));
		return { value: [], diagnostics };
	}
	if (!isRecord(parsed) || parsed.$schema !== AGENT_PLUGINS_MCP_SCHEMA || !isRecord(parsed.mcpServers)) {
		diagnostics.push(mcpDiagnostic("plugin_mcp_invalid_config", "mcp", "mcp.json top-level object is invalid"));
		return { value: [], diagnostics };
	}
	if (Object.keys(parsed).some((key) => key !== "$schema" && key !== "mcpServers")) {
		diagnostics.push(
			mcpDiagnostic("plugin_mcp_invalid_config", "mcp", "mcp.json contains an unknown top-level field"),
		);
		return { value: [], diagnostics };
	}
	const servers: AgentPluginMcpServer[] = [];
	for (const [name, value] of Object.entries(parsed.mcpServers)) {
		try {
			const server = parseServer(context.root, name, value);
			if (server === undefined) {
				diagnostics.push({
					...mcpDiagnostic(
						"plugin_mcp_unsupported_transport",
						"mcp-server",
						"MCP transport is not supported",
						"warning",
					),
					componentName: name,
				});
				continue;
			}
			servers.push(server);
		} catch (error) {
			diagnostics.push({
				...mcpDiagnostic(
					"plugin_mcp_invalid_server",
					"mcp-server",
					error instanceof Error ? error.message : "Invalid MCP server",
				),
				componentName: name,
			});
		}
	}
	return { value: servers, diagnostics };
}

function parseServer(root: string, name: string, value: unknown): AgentPluginMcpServer | undefined {
	if (!isRecord(value) || typeof value.type !== "string")
		throw new InvalidPluginMcpServer({ message: "MCP server must be an object with a type" });
	if (value.type === "stdio") return { name, ...parseStdio(root, value) };
	if (value.type === "streamable-http") return { name, ...parseHttp(value) };
	if (value.type === "sse") return { name, ...parseSse(value) };
	throw new InvalidPluginMcpServer({ message: `Unsupported MCP transport "${value.type}"` });
}

function parseStdio(root: string, value: Record<string, unknown>): Omit<AgentPluginStdioServer, "name"> {
	assertKeys(value, STDIO_KEYS);
	if (typeof value.command !== "string" || value.command.length === 0)
		throw new InvalidPluginMcpServer({ message: "stdio command is required" });
	if (!isBareCommand(value.command) && !value.command.startsWith("./"))
		throw new InvalidPluginMcpServer({ message: "stdio command must be a bare executable or ./ relative path" });
	if (value.command.startsWith("./") && !isInside(path.resolve(root, value.command), root)) {
		throw new InvalidPluginMcpServer({ message: "stdio command must remain inside Plugin root" });
	}
	const args = value.args === undefined ? [] : value.args;
	if (!Array.isArray(args) || !args.every((item) => typeof item === "string"))
		throw new InvalidPluginMcpServer({ message: "stdio args must be strings" });
	const env = value.env === undefined ? {} : value.env;
	if (
		!isRecord(env) ||
		!Object.entries(env).every(
			([key, item]) => !["PLUGIN_ROOT", "PLUGIN_DATA"].includes(key.toUpperCase()) && typeof item === "string",
		)
	) {
		throw new InvalidPluginMcpServer({
			message: "stdio env must contain only string values and cannot override reserved variables",
		});
	}
	if (value.cwd !== undefined && (typeof value.cwd !== "string" || !isAllowedCwd(value.cwd)))
		throw new InvalidPluginMcpServer({ message: "stdio cwd is invalid" });
	return {
		type: "stdio",
		command: value.command,
		args: args as string[],
		env: env as Record<string, string>,
		...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
	};
}

function parseHttp(value: Record<string, unknown>): Omit<AgentPluginHttpServer, "name"> {
	assertKeys(value, HTTP_KEYS);
	if (typeof value.url !== "string" || value.url.length === 0 || value.url !== value.url.trim())
		throw new InvalidPluginMcpServer({ message: "streamable-http url is required" });
	const url = new URL(value.url);
	if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash)
		throw new InvalidPluginMcpServer({ message: "streamable-http url is invalid" });
	if (url.protocol === "http:" && !isLoopbackHost(url.hostname))
		throw new InvalidPluginMcpServer({ message: "remote HTTP MCP endpoints must use HTTPS" });
	const headers = value.headers === undefined ? {} : value.headers;
	if (
		!isRecord(headers) ||
		!Object.entries(headers).every(
			([key, item]) => HEADER_NAME.test(key) && typeof item === "string" && !/[\r\n]/.test(item),
		)
	) {
		throw new InvalidPluginMcpServer({ message: "MCP headers are invalid" });
	}
	const lower = Object.keys(headers).map((key) => key.toLowerCase());
	if (new Set(lower).size !== lower.length)
		throw new InvalidPluginMcpServer({ message: "MCP headers contain duplicate names" });
	return { type: "streamable-http", url: value.url, headers: headers as Record<string, string> };
}

function parseSse(value: Record<string, unknown>): Omit<AgentPluginSseServer, "name"> {
	const parsed = parseHttp(value);
	return { type: "sse", url: parsed.url, headers: parsed.headers };
}

function assertKeys(value: Record<string, unknown>, allowed: Set<string>): void {
	if (Object.keys(value).some((key) => !allowed.has(key)))
		throw new InvalidPluginMcpServer({ message: "MCP server contains an unknown field" });
}

function isAllowedCwd(value: string): boolean {
	return (
		value.startsWith("./") ||
		value === PLUGIN_ROOT_PLACEHOLDER ||
		value.startsWith(`${PLUGIN_ROOT_PLACEHOLDER}/`) ||
		value === PLUGIN_DATA_PLACEHOLDER ||
		value.startsWith(`${PLUGIN_DATA_PLACEHOLDER}/`)
	);
}

function isBareCommand(value: string): boolean {
	return !value.includes("/") && !value.includes("\\") && !/[\s]/.test(value);
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function mcpDiagnostic(
	code: string,
	scope: "mcp" | "mcp-server",
	message: string,
	severity: AgentPluginDiagnostic["severity"] = "error",
): AgentPluginDiagnostic {
	return { code, severity, scope, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}
