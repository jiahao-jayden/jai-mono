import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	StreamableHTTPClientTransport,
	StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { DEFAULT_MCP_TIMEOUT, isHttpConfig, isStdioConfig, type McpServerConfig } from "./types.js";

const CLIENT_INFO = { name: "jai-coding-agent", version: "0.1.0" };

export type ConnectResult = {
	client: Client;
	transport: Transport;
	transportKind: "stdio" | "http" | "sse";
	pid?: number;
};

export type RemoteConnectOptions = {
	signal?: AbortSignal;
	authProvider?: import("@modelcontextprotocol/sdk/client/auth.js").OAuthClientProvider;
};

/** 生成一个已连接的 Client；调用方要自己处理失败/超时清理。 */
export async function connectClient(
	serverName: string,
	config: McpServerConfig,
	options?: RemoteConnectOptions,
): Promise<ConnectResult> {
	const timeout = config.timeout ?? DEFAULT_MCP_TIMEOUT;

	if (isStdioConfig(config)) {
		return connectStdio(serverName, config, timeout, options?.signal);
	}
	if (isHttpConfig(config)) {
		return connectRemote(serverName, config, timeout, options);
	}
	throw new Error(`Invalid MCP config for "${serverName}": missing both 'command' and 'url'`);
}

async function connectStdio(
	serverName: string,
	config: import("./types.js").McpStdioServerConfig,
	timeout: number,
	signal?: AbortSignal,
): Promise<ConnectResult> {
	const transport = new StdioClientTransport({
		command: config.command,
		args: config.args ?? [],
		env: config.env,
		cwd: config.cwd,
		stderr: "pipe",
	});

	const client = new Client(CLIENT_INFO, {});

	try {
		await withTimeout(client.connect(transport, { signal }), timeout, `connect to "${serverName}" stdio`);
	} catch (err) {
		await safeCloseTransport(transport);
		throw err;
	}

	const pid = transport.pid ?? undefined;
	return { client, transport, transportKind: "stdio", pid };
}

async function connectRemote(
	serverName: string,
	config: import("./types.js").McpHttpServerConfig,
	timeout: number,
	options?: RemoteConnectOptions,
): Promise<ConnectResult> {
	const url = new URL(config.url);
	const requestInit: RequestInit | undefined = config.headers ? { headers: config.headers } : undefined;

	// 先试 Streamable HTTP（MCP 协议主推）
	const httpTransport = new StreamableHTTPClientTransport(url, {
		authProvider: options?.authProvider,
		requestInit,
	});
	const httpClient = new Client(CLIENT_INFO, {});

	try {
		await withTimeout(
			httpClient.connect(httpTransport, { signal: options?.signal }),
			timeout,
			`connect to "${serverName}" via Streamable HTTP`,
		);
		return { client: httpClient, transport: httpTransport, transportKind: "http" };
	} catch (err) {
		await safeCloseTransport(httpTransport);
		// OAuth 引导阶段不要回退；让上层捕捉 UnauthorizedError 引导用户授权
		if (isUnauthorizedError(err)) throw err;
		// 4xx（特别是 404/405）和握手错误 → 回退到 SSE
		if (!shouldFallbackToSse(err)) throw err;
	}

	const sseTransport = new SSEClientTransport(url, {
		authProvider: options?.authProvider,
		requestInit,
	});
	const sseClient = new Client(CLIENT_INFO, {});

	try {
		await withTimeout(
			sseClient.connect(sseTransport, { signal: options?.signal }),
			timeout,
			`connect to "${serverName}" via SSE`,
		);
	} catch (err) {
		await safeCloseTransport(sseTransport);
		throw err;
	}

	return { client: sseClient, transport: sseTransport, transportKind: "sse" };
}

function shouldFallbackToSse(err: unknown): boolean {
	if (err instanceof StreamableHTTPError) {
		// 没有 code（握手失败）或 4xx → 大概率不是 Streamable HTTP server，回退 SSE
		if (err.code === undefined) return true;
		if (err.code >= 400 && err.code < 500) return true;
		return false;
	}
	const msg = err instanceof Error ? err.message : String(err);
	return /404|405|not\s*found|method\s*not\s*allowed|protocol/i.test(msg);
}

function isUnauthorizedError(err: unknown): boolean {
	if (!err) return false;
	const name = (err as { name?: string }).name;
	if (name === "UnauthorizedError") return true;
	const msg = err instanceof Error ? err.message : String(err);
	return /unauthorized|401/i.test(msg);
}

export async function safeCloseTransport(transport: Transport): Promise<void> {
	try {
		await transport.close();
	} catch {
		// ignore
	}
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`${label}: timeout after ${ms}ms`));
		}, ms);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}
