import { access, constants, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Result, type Result as ResultType } from "better-result";
import { connectMcpServers, McpConnectionFailed } from "../../mcp";
import { AgentPluginMcpConnectionFailed } from "../package/errors";
import { isInside } from "../package/paths";
import type { LoadedAgentPlugin } from "../package/types";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import type { AgentPluginMcpRuntime, AgentPluginMcpServer } from "./types";

const PLUGIN_DATA_PLACEHOLDER = ["$", "{PLUGIN_DATA}"].join("");

export interface AgentPluginMcpConnectOptions {
	readonly pluginDataDirectory: string;
	readonly signal?: AbortSignal;
}

export async function connectAgentPluginMcp(
	plugin: LoadedAgentPlugin,
	options: AgentPluginMcpConnectOptions,
): Promise<ResultType<AgentPluginMcpRuntime, AgentPluginMcpConnectionFailed>> {
	const diagnostics: AgentPluginDiagnostic[] = [];
	if (plugin.mcpServers.length === 0) {
		return Result.ok({ tools: [], diagnostics, close: async () => {} });
	}
	try {
		const pluginData = await preparePluginData(options.pluginDataDirectory);
		const servers: AgentPluginMcpServer[] = [];
		for (const server of plugin.mcpServers) {
			if (options.signal?.aborted) return Result.err(connectionError("<plugin>", "MCP connection was aborted"));
			try {
				servers.push(await resolveServer(plugin, server, pluginData));
			} catch (cause) {
				diagnostics.push({
					code: "plugin_mcp_connection_failed",
					severity: "error",
					scope: "mcp-server",
					componentName: server.name,
					message:
						cause instanceof AgentPluginMcpConnectionFailed
							? cause.message
							: "MCP server configuration could not be resolved",
				});
			}
		}
		const runtime = await connectMcpServers({
			namespace: plugin.manifest.name,
			servers,
			signal: options.signal,
		});
		if (runtime.isErr()) return Result.err(connectionError("<plugin>", runtime.error.message, runtime.error));
		return Result.ok({
			tools: runtime.value.tools,
			diagnostics: [
				...diagnostics,
				...runtime.value.diagnostics.map((diagnostic) => ({
					code: "plugin_mcp_connection_failed",
					severity: "error" as const,
					scope: "mcp-server" as const,
					componentName: diagnostic.serverName,
					message: diagnostic.message,
				})),
			],
			close: runtime.value.close,
		});
	} catch (cause) {
		if (cause instanceof AgentPluginMcpConnectionFailed) return Result.err(cause);
		if (cause instanceof McpConnectionFailed)
			return Result.err(connectionError(cause.serverName, cause.message, cause));
		return Result.err(connectionError("<plugin>", "MCP runtime could not be created", cause));
	}
}

async function resolveServer(
	plugin: LoadedAgentPlugin,
	server: AgentPluginMcpServer,
	pluginData: string,
): Promise<AgentPluginMcpServer> {
	if (server.type !== "stdio") return server;
	return {
		...server,
		command: await resolveCommand(plugin.root, server.command),
		args: server.args.map((value) => expandPlaceholders(value, plugin.root, pluginData)),
		env: {
			...Object.fromEntries(
				Object.entries(server.env).map(([key, value]) => [key, expandPlaceholders(value, plugin.root, pluginData)]),
			),
			PLUGIN_ROOT: plugin.root,
			PLUGIN_DATA: pluginData,
		},
		cwd: await resolveCwd(plugin.root, pluginData, server.cwd),
	};
}

async function preparePluginData(directory: string): Promise<string> {
	await mkdir(directory, { recursive: true });
	const canonical = await realpath(directory);
	const info = await stat(canonical);
	if (!info.isDirectory()) throw connectionError("<plugin>", "PLUGIN_DATA is not a directory");
	try {
		await access(canonical, constants.W_OK);
	} catch (cause) {
		throw connectionError("<plugin>", "PLUGIN_DATA is not writable", cause);
	}
	return canonical;
}

async function resolveCommand(root: string, command: string): Promise<string> {
	if (!command.startsWith("./")) return command;
	const candidate = path.resolve(root, command);
	const canonical = await realpath(candidate);
	const info = await stat(canonical);
	if (!isInside(canonical, root) || !info.isFile())
		throw connectionError("<server>", "stdio command escapes Plugin root or is not a file");
	return canonical;
}

async function resolveCwd(root: string, data: string, cwd: string | undefined): Promise<string | undefined> {
	if (!cwd) return undefined;
	const expanded = expandPlaceholders(cwd, root, data);
	const base = cwd.startsWith(PLUGIN_DATA_PLACEHOLDER) ? data : root;
	const candidate = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(root, expanded);
	const canonical = await realpath(candidate);
	if (!isInside(canonical, base)) throw connectionError("<server>", "stdio cwd escapes its allowed root");
	return canonical;
}

function expandPlaceholders(value: string, root: string, data: string): string {
	return value.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g, (_match, variable: "PLUGIN_ROOT" | "PLUGIN_DATA") =>
		variable === "PLUGIN_ROOT" ? root : data,
	);
}

function connectionError(serverName: string, message: string, cause?: unknown): AgentPluginMcpConnectionFailed {
	return new AgentPluginMcpConnectionFailed({ serverName, message, ...(cause === undefined ? {} : { cause }) });
}
