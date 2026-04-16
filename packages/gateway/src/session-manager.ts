import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "@jayden/jai-ai";
import { AgentSession, createDefaultTools, SettingsManager, Workspace } from "@jayden/jai-coding-agent";
import { JsonlSessionStore, type MessageEntry } from "@jayden/jai-session";
import { SessionIndex } from "./storage/session-index.js";
import type { SessionInfo } from "./types/api.js";

export type SessionManagerConfig = {
	jaiHome?: string;
};

export class SessionManager {
	private activeSessions = new Map<string, { session: AgentSession; workspaceId: string }>();
	private workspaces = new Map<string, Workspace>();
	private index!: SessionIndex;
	private settings!: SettingsManager;
	private jaiHome: string;

	private constructor(config: SessionManagerConfig) {
		this.jaiHome = config.jaiHome ?? join(homedir(), ".jai");
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

	private async resolveWorkspace(workspaceId: string): Promise<Workspace> {
		let ws = this.workspaces.get(workspaceId);
		if (ws) return ws;

		const cwd = join(this.jaiHome, "workspace", workspaceId);
		ws = await Workspace.create({ cwd });
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
		});

		const sessionId = session.getSessionId();
		const now = Date.now();
		this.activeSessions.set(sessionId, { session, workspaceId: wsId });

		const modelId = typeof model === "string" ? model : (model.config?.model ?? null);
		const info: SessionInfo = {
			sessionId,
			workspaceId: wsId,
			title: null,
			model: modelId,
			firstMessage: null,
			messageCount: 0,
			totalTokens: 0,
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

	async readMessages(sessionId: string): Promise<Message[] | null> {
		const active = this.activeSessions.get(sessionId);
		if (active) return active.session.getMessages();

		const record = this.index.get(sessionId);
		if (!record) return null;

		const workspace = await this.resolveWorkspace(record.workspaceId);
		const filePath = workspace.sessionPath(sessionId);
		const store = await JsonlSessionStore.open(filePath);
		const entries = store.getAllEntries();
		await store.close();

		return entries.filter((e): e is MessageEntry => e.type === "message").map((e) => e.message);
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
		return join(this.jaiHome, "workspace", workspaceId);
	}

	getSettings(): SettingsManager {
		return this.settings;
	}

	async saveSettings(patch: import("@jayden/jai-coding-agent").Settings): Promise<void> {
		await this.settings.save(patch);
	}

	async deleteProvider(providerId: string): Promise<void> {
		await this.settings.deleteProvider(providerId);
	}

	async handlePostChat(
		sessionId: string,
		opts: { text: string; attachmentFilename?: string; totalTokens: number },
	): Promise<{ title?: string }> {
		if (opts.totalTokens > 0) {
			const current = this.index.get(sessionId);
			const accumulated = (current?.totalTokens ?? 0) + opts.totalTokens;
			this.index.updateField(sessionId, "totalTokens", accumulated);
		}

		const info = this.index.get(sessionId);
		if (info && !info.firstMessage) {
			const firstMessage = opts.text.slice(0, 200) || opts.attachmentFilename || "Attachment";
			this.index.updateField(sessionId, "firstMessage", firstMessage);
		}

		if (info && !info.title) {
			const session = this.activeSessions.get(sessionId)?.session;
			if (session) {
				try {
					const model = this.settings.resolveModel();
					const baseURL = this.settings.get("baseURL");
					const title = await session.generateSessionTitle({ model, baseURL });
					if (title) {
						this.index.updateField(sessionId, "title", title);
						return { title };
					}
				} catch {}
			}
		}

		return {};
	}
}
