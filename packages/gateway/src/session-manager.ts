import { AgentSession, createDefaultTools, SettingsManager, Workspace } from "@jayden/jai-coding-agent";

export type GatewaySessionInfo = {
	sessionId: string;
	state: "idle" | "running" | "aborted";
	createdAt: number;
};

export type SessionManagerConfig = {
	cwd: string;
};

export class SessionManager {
	private sessions = new Map<string, { session: AgentSession; createdAt: number }>();
	private workspace!: Workspace;
	private settings!: SettingsManager;

	private constructor(private config: SessionManagerConfig) {}

	static async create(config: SessionManagerConfig): Promise<SessionManager> {
		const mgr = new SessionManager(config);
		await mgr.init();
		return mgr;
	}

	private async init(): Promise<void> {
		this.workspace = await Workspace.create({ cwd: this.config.cwd });
		this.settings = await SettingsManager.load(this.workspace);

		const env = this.settings.get("env");
		for (const [key, value] of Object.entries(env)) {
			process.env[key] ??= String(value);
		}
	}

	async createSession(): Promise<GatewaySessionInfo> {
		const model = this.settings.resolveModel();
		const tools = createDefaultTools(this.workspace.cwd);

		const session = await AgentSession.create({
			workspace: this.workspace,
			model,
			baseURL: this.settings.get("baseURL"),
			tools,
			maxIterations: this.settings.get("maxIterations"),
		});

		const sessionId = session.getSessionId();
		const createdAt = Date.now();
		this.sessions.set(sessionId, { session, createdAt });

		return {
			sessionId,
			state: session.getState(),
			createdAt,
		};
	}

	get(sessionId: string): AgentSession | undefined {
		return this.sessions.get(sessionId)?.session;
	}

	list(): GatewaySessionInfo[] {
		return Array.from(this.sessions.entries()).map(([id, { session, createdAt }]) => ({
			sessionId: id,
			state: session.getState(),
			createdAt,
		}));
	}

	async close(sessionId: string): Promise<boolean> {
		const entry = this.sessions.get(sessionId);
		if (!entry) return false;
		await entry.session.close();
		this.sessions.delete(sessionId);
		return true;
	}

	async closeAll(): Promise<void> {
		const promises = Array.from(this.sessions.values()).map((e) => e.session.close());
		await Promise.all(promises);
		this.sessions.clear();
	}

	getSettings(): SettingsManager {
		return this.settings;
	}

	getWorkspace(): Workspace {
		return this.workspace;
	}
}
