import { type AgentEvent, EventBus, runAgentLoop } from "@jayden/jai-agent";
import type { AssistantMessage, Message, UserMessage } from "@jayden/jai-ai";
import { buildSessionContext, JsonlSessionStore, type SessionStore } from "@jayden/jai-session";
import { NamedError } from "@jayden/jai-utils";
import z from "zod";
import { buildSystemPrompt, type SystemPromptContext } from "./system-prompt.js";
import type { SessionConfig, SessionState } from "./types.js";
import { Workspace } from "./workspace.js";

export class AgentSession {
	private config: SessionConfig;
	private workspace: Workspace;
	private store!: SessionStore;
	private eventBus = new EventBus();
	private abortController: AbortController | null = null;
	private state: SessionState = "idle";
	private sessionId: string;

	private lastEntryId!: string;

	private externalListeners: Array<(event: AgentEvent) => void> = [];

	private workspacePrompts: SystemPromptContext["workspace"] = {};

	private constructor(config: SessionConfig) {
		this.config = config;
		this.sessionId = config.sessionId ?? crypto.randomUUID();
		this.workspace = Workspace.create({ cwd: config.cwd });
	}

	static async create(config: SessionConfig): Promise<AgentSession> {
		const session = new AgentSession(config);
		await session.init();
		return session;
	}

	private async init(): Promise<void> {
		const sessionPath = this.workspace.sessionPath(this.sessionId);
		this.store = await JsonlSessionStore.open(sessionPath);

		const headerId = this.store.nextId();
		await this.store.append({
			type: "session",
			id: headerId,
			parentId: null,
			version: 1,
			sessionId: this.sessionId,
			timestamp: Date.now(),
			cwd: this.config.cwd,
			model: typeof this.config.model === "string" ? this.config.model : this.config.model.config.model,
		});
		this.lastEntryId = headerId;

		this.workspacePrompts = await this.loadWorkspacePrompts();
		this.wireEventPipeline();
	}

	async chat(text: string): Promise<AssistantMessage[]> {
		if (this.state === "running") {
			throw new AgentRunningError("AgentSession is already running");
		}
		this.state = "running";
		this.abortController = new AbortController();

		try {
			const userMsg: UserMessage = {
				role: "user",
				content: [{ type: "text", text }],
				timestamp: Date.now(),
			};
			await this.persistMessage(userMsg);

			const messages = buildSessionContext(this.store, this.lastEntryId);

			const systemPrompt = await buildSystemPrompt({
				cwd: this.config.cwd,
				tools: this.config.tools,
				workspace: this.workspacePrompts,
			});

			const result = await runAgentLoop({
				messages,
				model: this.config.model,
				systemPrompt,
				tools: this.config.tools,
				signal: this.abortController.signal,
				events: this.eventBus,
				maxIterations: this.config.maxIterations,
			});

			this.state = "idle";
			return result;
		} catch (err) {
			this.state = this.abortController?.signal.aborted ? "aborted" : "idle";
			throw err;
		}
	}

	abort(): void {
		this.abortController?.abort();
		this.state = "aborted";
	}

	async close(): Promise<void> {
		this.abort();
		await this.store.close();
	}

	onEvent(listener: (event: AgentEvent) => void): () => void {
		this.externalListeners.push(listener);
		return () => {
			this.externalListeners = this.externalListeners.filter((l) => l !== listener);
		};
	}

	private wireEventPipeline(): void {
		this.eventBus.subscribe((event) => {
			if (event.type === "message_end") {
				this.persistMessage(event.message);
			}

			for (const listener of this.externalListeners) {
				listener(event);
			}
		});
	}

	private async loadWorkspacePrompts(): Promise<SystemPromptContext["workspace"]> {
		const ws = this.workspace;
		const [soul, agents, tools] = await Promise.all([
			ws.resolvePromptFile("SOUL.md"),
			ws.resolvePromptFile("AGENTS.md"),
			ws.resolvePromptFile("TOOLS.md"),
		]);

		return { soul, agents, tools };
	}

	private async persistMessage(message: Message): Promise<void> {
		const entryId = this.store.nextId();
		await this.store.append({
			type: "message",
			id: entryId,
			parentId: this.lastEntryId,
			timestamp: message.timestamp,
			message,
		});
		this.lastEntryId = entryId;
	}
}

const AgentRunningError = NamedError.create("AgentIsRunningError", z.string());
