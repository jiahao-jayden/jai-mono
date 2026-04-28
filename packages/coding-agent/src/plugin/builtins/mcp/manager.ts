import type { AgentTool } from "@jayden/jai-agent";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { connectClient, safeCloseTransport, withTimeout } from "./client-factory.js";
import { PendingFlows } from "./oauth/pending-flows.js";
import { JaiOAuthProvider } from "./oauth/provider.js";
import { TokenStore } from "./oauth/token-store.js";
import { killProcessTree } from "./process-utils.js";
import { McpStatusBus } from "./status-bus.js";
import { mcpToolToAgentTool } from "./tool-adapter.js";
import {
	DEFAULT_MCP_TIMEOUT,
	isHttpConfig,
	type McpServerConfig,
	type McpServerInfo,
	type McpServerStatus,
} from "./types.js";

type ConnectedServer = {
	name: string;
	config: McpServerConfig;
	client: Client;
	transport: Transport;
	transportKind: "stdio" | "http" | "sse";
	pid?: number;
	tools: AgentTool[];
};

/**
 * 同时管理多个 MCP server 的连接、工具、状态。
 *
 * 设计：
 *  - 多 server 并行启动；单个失败不影响其他
 *  - 失败/超时立即关闭 transport，避免资源泄漏
 *  - stdio server 关闭时杀整棵进程树（pgrep + SIGTERM / taskkill /T）
 */
export type McpManagerOptions = {
	/** 用来存 OAuth tokens 的文件路径，一般是 `~/.jai/mcp-tokens.json` */
	tokenStorePath?: string;
	/** Gateway 暴露的 OAuth 回调，例如 http://127.0.0.1:18900/mcp/oauth/callback */
	oauthRedirectUrl?: string;
};

export class McpManager {
	private servers = new Map<string, ConnectedServer>();
	private status = new Map<string, McpServerStatus>();
	private bus = new McpStatusBus();
	private flows = new PendingFlows();
	private tokenStore?: TokenStore;
	private oauthRedirectUrl?: string;
	private configsByName = new Map<string, McpServerConfig>();

	constructor(opts: McpManagerOptions = {}) {
		if (opts.tokenStorePath) {
			this.tokenStore = new TokenStore(opts.tokenStorePath);
		}
		this.oauthRedirectUrl = opts.oauthRedirectUrl;
	}

	get statusBus(): McpStatusBus {
		return this.bus;
	}

	get pendingFlows(): PendingFlows {
		return this.flows;
	}

	/** 并行启动所有 server。返回成功 server 的工具集合。 */
	async start(configs: Record<string, McpServerConfig>): Promise<AgentTool[]> {
		const entries = Object.entries(configs);

		// 先把所有 server 标 pending，UI 立即可见
		for (const [name, config] of entries) {
			if (config.enabled === false) {
				this.setStatus(name, { status: "disabled" });
			} else {
				this.setStatus(name, { status: "pending" });
			}
		}

		for (const [name, config] of entries) {
			this.configsByName.set(name, config);
		}

		await Promise.all(
			entries.map(async ([name, config]) => {
				if (config.enabled === false) return;
				try {
					await this.connectOne(name, config);
				} catch (err) {
					if (this.handleAuthError(name, err)) return;
					const msg = err instanceof Error ? err.message : String(err);
					this.setStatus(name, { status: "failed", error: msg });
				}
			}),
		);

		return this.collectTools();
	}

	private buildAuthProvider(name: string): JaiOAuthProvider | undefined {
		if (!this.tokenStore || !this.oauthRedirectUrl) return undefined;
		return new JaiOAuthProvider({
			serverName: name,
			store: this.tokenStore,
			flows: this.flows,
			redirectUrl: this.oauthRedirectUrl,
		});
	}

	private handleAuthError(name: string, err: unknown): boolean {
		if (!isUnauthorized(err)) return false;
		const authUrl = this.flows.getAuthUrl(name);
		this.setStatus(name, {
			status: authUrl ? "needs_auth" : "needs_client_registration",
			...(authUrl ? { authUrl: authUrl.href } : {}),
		});
		return true;
	}

	private async connectOne(name: string, config: McpServerConfig): Promise<void> {
		const authProvider = isHttpConfig(config) ? this.buildAuthProvider(name) : undefined;
		const result = await connectClient(name, config, { authProvider });
		const { client, transport, transportKind, pid } = result;

		const timeout = config.timeout ?? DEFAULT_MCP_TIMEOUT;

		let toolList: import("@modelcontextprotocol/sdk/types.js").Tool[];
		try {
			const listed = await withTimeout(client.listTools(), timeout, `listTools "${name}"`);
			toolList = listed.tools;
		} catch (err) {
			await safeCloseTransport(transport);
			if (pid) await killProcessTree(pid).catch(() => {});
			throw err;
		}

		const tools = toolList.map((t) => mcpToolToAgentTool({ serverName: name, mcpTool: t, client, timeout }));

		this.servers.set(name, {
			name,
			config,
			client,
			transport,
			transportKind,
			pid,
			tools,
		});
		this.setStatus(
			name,
			{ status: "ready", toolCount: tools.length },
			tools.map((t) => t.name),
		);
	}

	listTools(): AgentTool[] {
		return this.collectTools();
	}

	private collectTools(): AgentTool[] {
		const out: AgentTool[] = [];
		for (const s of this.servers.values()) {
			out.push(...s.tools);
		}
		return out;
	}

	getStatus(): Map<string, McpServerStatus> {
		return new Map(this.status);
	}

	getInfos(): McpServerInfo[] {
		const infos: McpServerInfo[] = [];
		for (const [name, status] of this.status.entries()) {
			const server = this.servers.get(name);
			infos.push({
				name,
				transport: server?.transportKind ?? "stdio",
				status,
				tools: server?.tools.map((t) => t.name),
			});
		}
		return infos;
	}

	private setStatus(name: string, status: McpServerStatus, tools?: string[]): void {
		this.status.set(name, status);
		const server = this.servers.get(name);
		this.bus.emit({
			name,
			transport: server?.transportKind ?? "stdio",
			status,
			tools: tools ?? server?.tools.map((t) => t.name),
		});
	}

	/**
	 * Gateway 的 OAuth callback 路由收到 `?state=...&code=...` 后调用。
	 * 找到对应的 pending flow，注入 code，让 SDK 完成 token 交换并重新 connect。
	 *
	 * 返回 true 表示 state 匹配上了（无论后续是否 reconnect 成功）。
	 */
	async completeAuthByState(state: string, code: string): Promise<boolean> {
		// pending-flows 的 wait() 我们没在用——简化版：直接根据 state 找 server name
		// PendingFlows 维护 state→server 映射，但 wait 流程是为重试设计的。
		// 这里用一个最小化版本：把 state 解析回 server 后，重新 connect 并在 connect 前
		// 由 transport.finishAuth(code) 完成 token 交换。
		const serverName = this.flows.consumeStateForCompletion(state);
		if (!serverName) return false;

		const config = this.configsByName.get(serverName);
		if (!config || !isHttpConfig(config)) return true;

		this.setStatus(serverName, { status: "pending" });
		try {
			await this.reconnectAfterAuth(serverName, config, code);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus(serverName, { status: "failed", error: msg });
		}
		return true;
	}

	private async reconnectAfterAuth(
		name: string,
		config: import("./types.js").McpHttpServerConfig,
		code: string,
	): Promise<void> {
		// SDK 的 finishAuth 在 transport 上：但旧 transport 已经关掉了。
		// 用 fresh transport，OAuthProvider 会读 codeVerifier 并完成 token 交换。
		// finishAuth 路径：
		//   1. 用 OAuthProvider 拿到 code_verifier + client_information
		//   2. 用 code 换 tokens 并 saveTokens()
		//   3. 重新 connect
		const authProvider = this.buildAuthProvider(name);
		if (!authProvider) {
			throw new Error(`OAuth not configured (no token store / redirect URL)`);
		}

		// 直接用 SDK 的 helper：先 finishAuth，再 connect
		const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
		const url = new URL(config.url);
		const transport = new StreamableHTTPClientTransport(url, {
			authProvider,
			...(config.headers ? { requestInit: { headers: config.headers } } : {}),
		});

		try {
			await transport.finishAuth(code);
		} catch (err) {
			await safeCloseTransport(transport);
			throw err;
		}

		// 再走完整的 connect 流程（这次 tokens 已经在 store 里）
		await safeCloseTransport(transport);
		await this.connectOne(name, config);
	}

	/** 关闭所有 server。stdio 杀进程树，HTTP/SSE 走 transport.close()。 */
	async closeAll(): Promise<void> {
		const tasks = Array.from(this.servers.values()).map((s) => this.closeOne(s));
		await Promise.all(tasks);
		this.servers.clear();
	}

	private async closeOne(server: ConnectedServer): Promise<void> {
		try {
			await server.client.close();
		} catch {
			// ignore
		}
		await safeCloseTransport(server.transport);
		if (server.transportKind === "stdio" && server.pid) {
			await killProcessTree(server.pid).catch(() => {});
		}
	}
}

function isUnauthorized(err: unknown): boolean {
	if (!err) return false;
	const name = (err as { name?: string }).name;
	if (name === "UnauthorizedError") return true;
	const msg = err instanceof Error ? err.message : String(err);
	return /unauthorized|401/i.test(msg);
}
