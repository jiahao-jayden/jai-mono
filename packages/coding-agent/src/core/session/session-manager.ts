import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "@jayden/jai-ai";
import { JsonlSessionStore } from "@jayden/jai-session";
import { BUILTIN_PLUGINS, type BuiltinPluginContext } from "../../plugin/builtins/index.js";
import { createPluginAPI } from "../../plugin/host/api-factory.js";
import { loadPluginsFromDirs } from "../../plugin/host/loader.js";
import { type PluginScanResult, scanPlugins } from "../../plugin/host/scanner.js";
import type { RegisteredCommand } from "../../plugin/types.js";
import { createDefaultTools } from "../../tools/index.js";
import { SettingsManager } from "../config/settings.js";
import { Workspace } from "../config/workspace.js";
import type { McpServerInfo } from "../../plugin/builtins/mcp/index.js";
import { AgentSession, type CompactionMarker, extractHistory } from "./agent-session.js";
import { SessionIndex, type SessionInfo } from "./session-index.js";

export type { PluginEnvEntry, PluginScanEntry, PluginScanResult } from "../../plugin/host/scanner.js";

export type SessionManagerConfig = {
	jaiHome?: string;
	/** Gateway 暴露的 OAuth 回调 URL；MCP HTTP server 用它走 OAuth 2.1 授权码流 */
	oauthRedirectUrl?: string;
};

export class SessionManager {
	private activeSessions = new Map<string, { session: AgentSession; workspaceId: string }>();
	private workspaces = new Map<string, Workspace>();
	private index!: SessionIndex;
	private settings!: SettingsManager;
	private jaiHome: string;
	private oauthRedirectUrl?: string;

	private constructor(config: SessionManagerConfig) {
		this.jaiHome = config.jaiHome ?? join(homedir(), ".jai");
		this.oauthRedirectUrl = config.oauthRedirectUrl;
	}

	/** 由 gateway 在已知监听端口后注入；之后创建/恢复的 session 都用这个 URL。 */
	setOAuthRedirectUrl(url: string | undefined): void {
		this.oauthRedirectUrl = url;
	}

	static async create(config?: SessionManagerConfig): Promise<SessionManager> {
		const mgr = new SessionManager(config ?? {});
		await mgr.init();
		return mgr;
	}

	private async init(): Promise<void> {
		this.index = await SessionIndex.open(join(this.jaiHome, "index.db"));

		const defaultWs = await this.resolveWorkspace("default");
		this.settings = await SettingsManager.load(defaultWs);

		const env = this.settings.get("env");
		for (const [key, value] of Object.entries(env)) {
			process.env[key] ??= String(value);
		}
	}

	private workspaceCwd(workspaceId: string): string {
		return join(this.jaiHome, "workspace", workspaceId);
	}

	private async resolveWorkspace(workspaceId: string): Promise<Workspace> {
		let ws = this.workspaces.get(workspaceId);
		if (ws) return ws;

		ws = await Workspace.create({ cwd: this.workspaceCwd(workspaceId), workspaceId, jaiHome: this.jaiHome });
		this.workspaces.set(workspaceId, ws);
		return ws;
	}

	async createSession(options?: { workspaceId?: string }): Promise<SessionInfo> {
		let wsId = options?.workspaceId ?? "default";
		if (wsId === "new") wsId = crypto.randomUUID();

		const workspace = await this.resolveWorkspace(wsId);
		const model = this.settings.resolveModel();
		const tools = createDefaultTools(workspace.cwd);

		const session = await AgentSession.create({
			workspace,
			model,
			baseURL: this.settings.get("baseURL"),
			tools,
			maxIterations: this.settings.get("maxIterations"),
			permissionSettings: this.settings.get("permission"),
			pluginSettings: this.settings.get("plugins"),
			envSettings: this.getPluginEnvSettings(),
			mcpServers: this.settings.get("mcpServers"),
			oauthRedirectUrl: this.oauthRedirectUrl,
		});

		const sessionId = session.getSessionId();
		const now = Date.now();
		this.activeSessions.set(sessionId, { session, workspaceId: wsId });

		const modelId = typeof model === "string" ? model : (model.config?.model ?? null);
		const info: SessionInfo = {
			sessionId,
			workspaceId: wsId,
			filePath: workspace.sessionPath(sessionId),
			title: null,
			model: modelId,
			firstMessage: null,
			messageCount: 0,
			totalTokens: 0,
			lastInputTokens: 0,
			lastOutputTokens: 0,
			createdAt: now,
			updatedAt: now,
		};
		this.index.upsert(info);
		return info;
	}

	get(sessionId: string): AgentSession | undefined {
		return this.activeSessions.get(sessionId)?.session;
	}

	async getOrRestore(sessionId: string): Promise<AgentSession | undefined> {
		const active = this.activeSessions.get(sessionId);
		if (active) return active.session;

		const record = this.index.get(sessionId);
		if (!record) return undefined;

		const workspace = await this.resolveWorkspace(record.workspaceId);
		const model = this.settings.resolveModel();
		const tools = createDefaultTools(workspace.cwd);

		const session = await AgentSession.restore({
			workspace,
			model,
			baseURL: this.settings.get("baseURL"),
			tools,
			sessionId,
			maxIterations: this.settings.get("maxIterations"),
			permissionSettings: this.settings.get("permission"),
			pluginSettings: this.settings.get("plugins"),
			envSettings: this.getPluginEnvSettings(),
			mcpServers: this.settings.get("mcpServers"),
			oauthRedirectUrl: this.oauthRedirectUrl,
		});

		this.activeSessions.set(sessionId, { session, workspaceId: record.workspaceId });
		return session;
	}

	getSessionInfo(sessionId: string): SessionInfo | null {
		const record = this.index.get(sessionId);
		if (!record) return null;
		return { ...record };
	}

	list(options?: { workspaceId?: string }): SessionInfo[] {
		return this.index.list(options);
	}

	async readMessages(sessionId: string): Promise<{ messages: Message[]; compactions: CompactionMarker[] } | null> {
		const active = this.activeSessions.get(sessionId);
		if (active) return active.session.getHistory();

		const record = this.index.get(sessionId);
		if (!record) return null;

		const workspace = await this.resolveWorkspace(record.workspaceId);
		const filePath = record.filePath ?? workspace.sessionPath(sessionId);
		const store = await JsonlSessionStore.open(filePath);
		const entries = store.getAllEntries();
		await store.close();

		return extractHistory(entries);
	}

	async close(sessionId: string): Promise<boolean> {
		const entry = this.activeSessions.get(sessionId);
		if (entry) {
			await entry.session.close();
			this.activeSessions.delete(sessionId);
		}
		return this.index.delete(sessionId);
	}

	async closeAll(): Promise<void> {
		const promises = Array.from(this.activeSessions.values()).map((e) => e.session.close());
		await Promise.all(promises);
		this.activeSessions.clear();
		this.index.close();
	}

	updateSessionIndex(sessionId: string, field: keyof SessionInfo, value: string | number | null): void {
		this.index.updateField(sessionId, field, value);
	}

	getJaiHome(): string {
		return this.jaiHome;
	}

	getWorkspacePath(workspaceId: string): string {
		return this.workspaceCwd(workspaceId);
	}

	getSettings(): SettingsManager {
		return this.settings;
	}

	getPluginEnvSettings(): Readonly<Record<string, string>> {
		const userEnv = this.settings.get("env") ?? {};
		return Object.freeze({ JAI_HOME: this.jaiHome, ...userEnv });
	}

	async listAvailableCommands(options?: { workspaceId?: string }): Promise<RegisteredCommand[]> {
		const wsId = options?.workspaceId ?? "default";
		const workspace = await this.resolveWorkspace(wsId);

		const result = await loadPluginsFromDirs([{ path: join(this.jaiHome, "plugins") }], {
			pluginSettings: this.settings.get("plugins"),
			envSettings: this.getPluginEnvSettings(),
		});

		const ctx: BuiltinPluginContext = {
			cwd: workspace.cwd,
			jaiHome: workspace.jaiHome,
			pluginSettings: this.settings.get("plugins") ?? {},
			mcpServers: this.settings.get("mcpServers"),
			onSkillInvoked: () => {},
		};

		for (const def of BUILTIN_PLUGINS) {
			if (def.enabled && !(await def.enabled(ctx))) continue;
			try {
				const api = createPluginAPI(result.registry, def.meta);
				await def.setup(api, ctx);
			} catch (err) {
				console.warn(
					`[builtin:${def.meta.name}] command enumeration error: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		return result.registry.listCommands();
	}

	async scanPlugins(): Promise<PluginScanResult> {
		return scanPlugins({
			jaiHome: this.jaiHome,
			pluginSettings: this.settings.get("plugins"),
			envSettings: this.getPluginEnvSettings(),
		});
	}

	async handlePostChat(
		sessionId: string,
		opts: {
			text: string;
			attachmentFilename?: string;
			stepTokensSum: number;
			lastInputTokens: number;
			lastOutputTokens: number;
		},
	): Promise<void> {
		if (opts.stepTokensSum > 0) {
			const current = this.index.get(sessionId);
			const accumulated = (current?.totalTokens ?? 0) + opts.stepTokensSum;
			this.index.updateField(sessionId, "totalTokens", accumulated);
		}
		if (opts.lastInputTokens > 0 || opts.lastOutputTokens > 0) {
			this.index.updateField(sessionId, "lastInputTokens", opts.lastInputTokens);
			this.index.updateField(sessionId, "lastOutputTokens", opts.lastOutputTokens);
		}

		const info = this.index.get(sessionId);
		if (info && !info.firstMessage) {
			const firstMessage = opts.text.slice(0, 200) || opts.attachmentFilename || "Attachment";
			this.index.updateField(sessionId, "firstMessage", firstMessage);
		}
	}

	persistSessionTitle(sessionId: string, title: string): void {
		const info = this.index.get(sessionId);
		if (!info || info.title) return;
		this.index.updateField(sessionId, "title", title);
	}

	/**
	 * 聚合所有活跃 session 的 MCP server 状态。
	 * 多个 session 共享同一组配置，状态以「最后写入」为准（同 server 名通常一致）。
	 */
	listMcpStatus(): McpServerInfo[] {
		const merged = new Map<string, McpServerInfo>();
		for (const { session } of this.activeSessions.values()) {
			const mgr = session.getMcpManager();
			if (!mgr) continue;
			for (const info of mgr.getInfos()) {
				merged.set(info.name, info);
			}
		}
		return Array.from(merged.values());
	}

	/**
	 * 用 state 找对应 session 的 MCP manager，注入授权码完成 OAuth。
	 * 返回是否成功匹配 state（false 表示找不到对应的 pending flow）。
	 */
	async completeMcpAuth(state: string, code: string): Promise<boolean> {
		for (const { session } of this.activeSessions.values()) {
			const mgr = session.getMcpManager();
			if (!mgr) continue;
			if (await mgr.completeAuthByState(state, code)) return true;
		}
		return false;
	}

	/**
	 * 重新加载所有活跃 session 的 MCP servers：从 registry 摘掉旧工具，
	 * 关掉旧 manager，再按当前 settings 重新 setup。
	 */
	async reloadMcp(): Promise<void> {
		const configs = this.settings.get("mcpServers");
		const tasks = Array.from(this.activeSessions.values()).map(({ session }) =>
			session.reloadMcp(configs).catch((err) => {
				console.warn(
					`[mcp:reload] session ${session.getSessionId()} failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}),
		);
		await Promise.all(tasks);
	}
}
