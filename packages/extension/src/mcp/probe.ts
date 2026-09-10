import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Result, type Result as ResultType } from "better-result";
import { createTransport } from "./runtime";
import type { McpExtensionConfiguration, McpServer } from "./types";

export interface McpServerStatus {
	readonly name: string;
	readonly type: McpServer["type"];
	readonly connected: boolean;
	readonly toolCount: number;
	readonly error?: string;
}

export interface McpProbeResult {
	readonly servers: readonly McpServerStatus[];
}

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/** One-time connection test for each configured MCP server. Closes every connection immediately. */
export async function probeMcpServers(
	configuration: McpExtensionConfiguration,
	options: { readonly timeoutMs?: number } = {},
): Promise<ResultType<McpProbeResult, never>> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	const results = await Promise.all(
		Object.values(configuration.servers).map((server) => probeServer(server, timeoutMs)),
	);
	return Result.ok({ servers: results });
}

async function probeServer(server: McpServer, timeoutMs: number): Promise<McpServerStatus> {
	const client = new Client({ name: "jai-mcp-probe", version: "0.1.0" });
	try {
		await withTimeout(client.connect(createTransport(server)), timeoutMs);
		const listed = await withTimeout(client.listTools(), timeoutMs);
		return {
			name: server.name,
			type: server.type,
			connected: true,
			toolCount: listed.tools.length,
		};
	} catch {
		return {
			name: server.name,
			type: server.type,
			connected: false,
			toolCount: 0,
			error: `Could not connect to MCP server "${server.name}"`,
		};
	} finally {
		await client.close().catch(() => {});
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Probe timed out")), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
