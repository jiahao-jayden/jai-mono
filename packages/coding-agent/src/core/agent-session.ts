import { type AgentEvent, EventBus, runAgentLoop } from "@jayden/jai-agent";
import type {
	AssistantMessage,
	FileContent,
	ImageContent,
	Message,
	ModelInfo,
	TextContent,
	UserMessage,
} from "@jayden/jai-ai";
import { resolveModelInfo } from "@jayden/jai-ai";
import { buildSessionContext, JsonlSessionStore, type MessageEntry, type SessionStore } from "@jayden/jai-session";
import { NamedError } from "@jayden/jai-utils";
import z from "zod";
import { processAttachments } from "./attachments/processor.js";
import type { RawAttachment } from "./attachments/types.js";
import {
	collectRecentFileReadPaths,
	compactMessages,
	formatCompactSummary,
	microcompact,
	shouldCompact,
} from "./compaction.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { buildTitleInput, generateTitle } from "./title.js";
import type { ResolvedPrompts, SessionConfig, SessionState } from "./types.js";

export class AgentSession {
	private config: SessionConfig;
	private store!: SessionStore;
	private eventBus = new EventBus();
	private abortController: AbortController | null = null;
	private state: SessionState = "idle";
	private sessionId: string;

	private lastEntryId!: string;

	private externalListeners: Array<(event: AgentEvent) => void> = [];

	private compactFailCount = 0;
	private lastInputTokens = 0;
	private static MAX_COMPACT_FAILURES = 3;

	private prompts!: ResolvedPrompts;

	private firstUserInput: { text: string; attachments?: RawAttachment[] } | null = null;

	private constructor(config: SessionConfig) {
		this.config = config;
		this.sessionId = config.sessionId ?? crypto.randomUUID();
	}

	static async create(config: SessionConfig): Promise<AgentSession> {
		const session = new AgentSession(config);
		await session.init();
		return session;
	}

	static async restore(config: SessionConfig & { sessionId: string }): Promise<AgentSession> {
		const session = new AgentSession(config);
		await session.rehydrate();
		return session;
	}

	private get workspace() {
		return this.config.workspace;
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
			cwd: this.workspace.cwd,
		});
		this.lastEntryId = headerId;

		this.prompts = await this.workspace.loadPrompts();
		this.wireEventPipeline();
	}

	private async rehydrate(): Promise<void> {
		const sessionPath = this.workspace.sessionPath(this.sessionId);
		this.store = await JsonlSessionStore.open(sessionPath);

		const entries = this.store.getAllEntries();
		if (entries.length === 0) {
			throw new Error(`Session file is empty: ${sessionPath}`);
		}
		this.lastEntryId = entries[entries.length - 1].id;

		this.prompts = await this.workspace.loadPrompts();
		this.wireEventPipeline();
	}

	async chat(
		text: string,
		options?: {
			model?: ModelInfo | string;
			baseURL?: string;
			reasoningEffort?: string;
			attachments?: RawAttachment[];
		},
	): Promise<AssistantMessage[]> {
		if (this.state === "running") {
			throw new AgentRunningError("AgentSession is already running");
		}
		this.state = "running";
		this.abortController = new AbortController();

		try {
			if (!this.firstUserInput) {
				this.firstUserInput = { text, attachments: options?.attachments };
			}

			const content: (TextContent | ImageContent | FileContent)[] = [{ type: "text", text }];

			if (options?.attachments?.length) {
				const modelRef = options?.model ?? this.config.model;
				const capabilities =
					typeof modelRef === "string"
						? resolveModelInfo(modelRef, {
								apiKey: undefined,
								baseURL: options?.baseURL ?? this.config.baseURL,
							}).capabilities
						: modelRef.capabilities;
				const processed = await processAttachments(options.attachments, capabilities);
				content.push(...processed);
			}

			const userMsg: UserMessage = {
				role: "user",
				content,
				timestamp: Date.now(),
			};
			await this.persistMessage(userMsg);

			const modelRef = options?.model ?? this.config.model;
			const modelInfo =
				typeof modelRef === "string"
					? resolveModelInfo(modelRef, { apiKey: undefined, baseURL: options?.baseURL ?? this.config.baseURL })
					: modelRef;
			const contextLimit = modelInfo.limit.context;

			// Pre-loop compact check: covers the "first turn already over-limit"
			// case that the post-loop fallback can't help with (it never runs
			// if runAgentLoop throws prompt_too_long).
			await this.maybeCompact(this.lastInputTokens, modelInfo);

			const messages = buildSessionContext(this.store, this.lastEntryId);

			const systemPrompt = buildSystemPrompt({
				cwd: this.workspace.cwd,
				tools: this.config.tools,
				prompts: this.prompts,
			});

			const result = await runAgentLoop({
				messages,
				model: modelRef,
				baseURL: options?.baseURL ?? this.config.baseURL,
				reasoningEffort: options?.reasoningEffort,
				systemPrompt,
				tools: this.config.tools,
				signal: this.abortController.signal,
				events: this.eventBus,
				maxIterations: this.config.maxIterations,
				contextTransform: async (msgs) =>
					microcompact({
						messages: msgs,
						lastInputTokens: this.lastInputTokens,
						contextLimit,
					}),
			});

			// Post-loop fallback: if the loop ran successfully but we're now close
			// to the ceiling, compact proactively so the next chat() won't blow up.
			await this.maybeCompact(this.lastInputTokens, modelInfo);

			this.state = "idle";
			return result;
		} catch (err) {
			this.state = this.abortController?.signal.aborted ? "aborted" : "idle";
			throw err;
		}
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getState(): SessionState {
		return this.state;
	}

	getMessages(): Message[] {
		const entries = this.store.getBranch(this.lastEntryId);
		return entries.filter((e): e is MessageEntry => e.type === "message").map((e) => e.message);
	}

	abort(): void {
		this.abortController?.abort();
		this.state = "aborted";
	}

	async close(): Promise<void> {
		this.abort();
		await this.store.close();
	}

	async generateSessionTitle(options?: { model?: ModelInfo | string; baseURL?: string }): Promise<string | null> {
		if (!this.firstUserInput) return null;
		const titleInput = buildTitleInput(this.firstUserInput.text, this.firstUserInput.attachments);
		return generateTitle(titleInput, options?.model ?? this.config.model, options?.baseURL ?? this.config.baseURL);
	}

	onEvent(listener: (event: AgentEvent) => void): () => void {
		this.externalListeners.push(listener);
		return () => {
			this.externalListeners = this.externalListeners.filter((l) => l !== listener);
		};
	}

	private async maybeCompact(inputTokens: number, modelInfo: ModelInfo): Promise<void> {
		// Circuit breaker: stop trying after repeated failures
		if (this.compactFailCount >= AgentSession.MAX_COMPACT_FAILURES) return;
		if (inputTokens <= 0) return;
		if (!shouldCompact(inputTokens, modelInfo.limit.context)) return;

		// Collect MessageEntries from the current branch once; we need both the
		// reconstructed Message[] (for the LLM call) and the entry IDs (for the
		// persisted CompactionEntry).
		const branch = this.store.getBranch(this.lastEntryId);
		const messageEntries = branch.filter((e): e is MessageEntry => e.type === "message");
		if (messageEntries.length < 4) return;

		// Initial split: keep ~20% of messages (minimum 6).
		const initialKeepCount = Math.max(6, Math.floor(messageEntries.length * 0.2));
		let firstKeptIndex = messageEntries.length - initialKeepCount;

		// Align firstKeptIndex forward to a user-role boundary so the kept tail
		// never starts with an orphan tool_result and the summarized prefix never
		// ends with an assistant whose tool_call has no matching tool_result.
		// Pairings within a turn: [user] -> [assistant(tool_call)] -> [tool_result, ...]
		while (firstKeptIndex < messageEntries.length && messageEntries[firstKeptIndex].message.role !== "user") {
			firstKeptIndex++;
		}
		if (firstKeptIndex >= messageEntries.length) return;

		const toSummarizeEntries = messageEntries.slice(0, firstKeptIndex);
		const toSummarize = toSummarizeEntries.map((e) => e.message);
		if (toSummarize.length < 2) return;

		const firstKeptEntry = messageEntries[firstKeptIndex];

		try {
			for (const listener of this.externalListeners) {
				listener({ type: "compaction_start" });
			}

			const rawSummary = await compactMessages({
				messages: toSummarize,
				model: modelInfo,
				baseURL: this.config.baseURL,
				signal: this.abortController?.signal,
			});

			let summary = formatCompactSummary(rawSummary);

			// Post-compact file hints: remind the agent which files were in
			// focus before compaction. Contents are not re-attached — the agent
			// should FileRead them again on demand.
			const recentFiles = collectRecentFileReadPaths(toSummarize);
			if (recentFiles.length > 0) {
				const list = recentFiles.map((p) => `- ${p}`).join("\n");
				summary = `${summary}\n\n[Recently viewed files before compaction]\n${list}\n(Their contents are not re-attached — re-read if needed.)`;
			}

			const compactionId = this.store.nextId();
			await this.store.append({
				type: "compaction",
				id: compactionId,
				parentId: this.lastEntryId,
				timestamp: Date.now(),
				summary,
				firstKeptEntryId: firstKeptEntry.id,
			});
			this.lastEntryId = compactionId;

			this.compactFailCount = 0;

			for (const listener of this.externalListeners) {
				listener({ type: "compaction_end", summary });
			}
		} catch {
			this.compactFailCount++;
			// Non-fatal: compaction failure should not break the session
		}
	}

	private wireEventPipeline(): void {
		this.eventBus.subscribe((event) => {
			if (event.type === "message_end") {
				this.persistMessage(event.message);
			}

			// Track inputTokens in real time so microcompact / maybeCompact see
			// the latest count without a one-turn lag. step_finish carries the
			// usage delta for each API call within the loop.
			if (event.type === "stream" && event.event.type === "step_finish") {
				this.lastInputTokens = event.event.usage.inputTokens;
			}

			for (const listener of this.externalListeners) {
				listener(event);
			}
		});
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
