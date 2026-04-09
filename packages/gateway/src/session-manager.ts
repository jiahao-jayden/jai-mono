import { homedir } from "node:os";
import { join } from "node:path";
import { AgentSession, createDefaultTools, SettingsManager, Workspace } from "@jayden/jai-coding-agent";
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

		const modelId = typeof model === "string" ? model : model.config?.model ?? null;
		const info: SessionInfo = {
			sessionId,
			workspaceId: wsId,
			state: session.getState(),
			title: null,
			model: modelId,
			firstMessage: null,
			messageCount: 0,
			totalTokens: 0,
			tags: [],
			createdAt: now,
			updatedAt: now,
		};
		this.index.upsert(info);
		return info;
	}

	get(sessionId: string): AgentSession | undefined {
		return this.activeSessions.get(sessionId)?.session;
	}

	getSessionInfo(sessionId: string): SessionInfo | null {
		const record = this.index.get(sessionId);
		if (!record) return null;

		const active = this.activeSessions.get(sessionId);
		const state = active ? active.session.getState() : (record.state as SessionInfo["state"]);
		return { ...record, state };
	}

	list(options?: { workspaceId?: string }): SessionInfo[] {
		const rows = this.index.list(options);
		return rows.map((row) => {
			const active = this.activeSessions.get(row.sessionId);
			const state = active ? active.session.getState() : (row.state as SessionInfo["state"]);
			return { ...row, state };
		});
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

	getSettings(): SettingsManager {
		return this.settings;
	}

	async saveSettings(patch: import("@jayden/jai-coding-agent").Settings): Promise<void> {
		await this.settings.save(patch);
	}

	async deleteProvider(providerId: string): Promise<void> {
		await this.settings.deleteProvider(providerId);
	}
}
