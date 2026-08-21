import type {
	CodingAgent,
	CodingAgentEvent,
	CodingAgentMessage,
	CodingAttachment,
	CodingExtensionApprovalDecision,
	CodingExtensionApprovalRequest,
	CodingPermissionDecision,
	CodingPermissionRequest,
} from "@jai/coding-agent";
import { toErrorEnvelope } from "@jai/common";
import { TaggedError } from "better-result";
import type {
	DesktopAgentEvent,
	DesktopAgentEventEnvelope,
	DesktopAgentMessageInput,
	DesktopAgentMode,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopArtifact,
	DesktopCompactionItem,
	DesktopExtensionApprovalRequest,
	DesktopExtensionPermissionItem,
	DesktopExtensionPermissionResolution,
	DesktopMessageItem,
	DesktopPermissionItem,
	DesktopTodos,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { DesktopApprovalRegistry } from "./approval-registry";
import { sortArtifacts } from "./artifacts";
import { projectSessionTodos } from "./projection/durable";
import {
	assistantPartItem,
	COMPACTION_SUMMARY_MAX,
	type DesktopAssistantItem,
	isRecord,
	truncate,
	userMessageItem,
} from "./projection/items";
import {
	type LiveProjection,
	type LiveProjectionContext,
	projectMessageUpdate,
	projectToolProgress,
	projectToolStart,
} from "./projection/live";

type DesktopAgentErrorInit = { readonly data?: { readonly sessionId: string }; readonly message: string };
class DesktopAgentFactoryUnavailable extends TaggedError("desktop_agent.factory_unavailable")<DesktopAgentErrorInit> {}
class DesktopAgentSessionNotFound extends TaggedError("desktop_agent.session_not_found")<DesktopAgentErrorInit> {}
class DesktopAgentSessionBusy extends TaggedError("desktop_agent.session_busy")<DesktopAgentErrorInit> {}

function desktopAgentError(
	reason: "factory_unavailable" | "session_not_found" | "session_busy",
	init: DesktopAgentErrorInit,
) {
	switch (reason) {
		case "factory_unavailable":
			return new DesktopAgentFactoryUnavailable(init);
		case "session_not_found":
			return new DesktopAgentSessionNotFound(init);
		case "session_busy":
			return new DesktopAgentSessionBusy(init);
	}
}

function completedCompactionItem(outcome: unknown): DesktopCompactionItem | undefined {
	if (!isRecord(outcome) || outcome.status !== "success" || !isRecord(outcome.entry)) return undefined;

	const entry = outcome.entry;
	if (typeof entry.id !== "string" || typeof entry.summary !== "string" || typeof entry.timestamp !== "string") {
		return undefined;
	}

	const timestamp = Date.parse(entry.timestamp);
	if (!Number.isFinite(timestamp)) return undefined;

	return {
		kind: "compaction",
		id: `compaction:${entry.id}`,
		summary: truncate(entry.summary, COMPACTION_SUMMARY_MAX),
		timestamp,
		status: "complete",
	};
}

export interface DesktopAgentSendInput extends DesktopAgentMessageInput {
	readonly resolvedAttachments?: readonly CodingAttachment[];
}

export interface DesktopAgentFactoryContext {
	readonly sessionId: string;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
	readonly requestApproval: (
		request: CodingPermissionRequest,
		signal?: AbortSignal,
	) => Promise<CodingPermissionDecision>;
	readonly requestExtensionApproval: (
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	) => Promise<CodingExtensionApprovalDecision>;
}

export type DesktopAgentFactory = (context: DesktopAgentFactoryContext) => Promise<CodingAgent>;
export type DesktopAgentEventSink = (envelope: DesktopAgentEventEnvelope) => void;
export interface DesktopRunCompletedContext {
	readonly sessionId: string;
	readonly firstMessage: string;
	readonly messages: readonly CodingAgentMessage[];
	readonly agent: CodingAgent;
}

interface SessionRuntime {
	readonly sessionId: string;
	modelRef: string;
	mode: DesktopAgentMode;
	agent: CodingAgent;
	readonly items: Map<string, DesktopTranscriptItem>;
	readonly artifacts: Map<string, DesktopArtifact>;
	unsubscribe: () => void;
	status: DesktopAgentStatus;
	todos?: DesktopTodos;
	closed: boolean;
	seq: number;
	nextMessageId: number;
	nextCompactionId: number;
	invalidateAfterRun: boolean;
	pendingRuns: number;
	pendingCompactionId?: string;
	rebinding?: Promise<void>;
	currentTurnId?: string;
	activeAssistantId?: string;
	activeUserId?: string;
	readonly pendingTranscriptUpdates: Map<string, Extract<DesktopAgentEvent, { readonly type: "transcript_upsert" }>>;
	flushTimer?: ReturnType<typeof setTimeout>;
}

export class DesktopAgentHost {
	readonly #sessions = new Map<string, SessionRuntime>();
	readonly #creating = new Map<string, Promise<SessionRuntime>>();
	readonly #approvals = new DesktopApprovalRegistry<CodingPermissionRequest, CodingPermissionDecision>();
	readonly #extensionApprovals = new DesktopApprovalRegistry<
		DesktopExtensionApprovalRequest,
		CodingExtensionApprovalDecision
	>();
	readonly #emit: DesktopAgentEventSink;
	#factory?: DesktopAgentFactory;
	#onSessionActivity?: (sessionId: string) => void;
	#onRunCompleted?: (context: DesktopRunCompletedContext) => void | Promise<void>;

	constructor(emit: DesktopAgentEventSink, factory?: DesktopAgentFactory) {
		this.#emit = emit;
		this.#factory = factory;
	}

	setFactory(factory: DesktopAgentFactory): void {
		this.#factory = factory;
	}

	setSessionActivityListener(listener: (sessionId: string) => void): void {
		this.#onSessionActivity = listener;
	}

	setRunCompletedListener(listener: (context: DesktopRunCompletedContext) => void | Promise<void>): void {
		this.#onRunCompleted = listener;
	}

	hasSession(sessionId: string): boolean {
		return this.#sessions.has(sessionId);
	}

	runningSessionIds(): string[] {
		return [...this.#sessions.values()]
			.filter((runtime) => runtime.status === "running")
			.map((runtime) => runtime.sessionId);
	}

	async send(input: DesktopAgentSendInput): Promise<{ readonly accepted: true }> {
		const runtime = await this.#getOrCreate(input);
		if (runtime.rebinding) await runtime.rebinding;
		runtime.pendingRuns += 1;
		runtime.status = "running";
		this.#emitNow(runtime, { type: "status", status: "running" });
		const run = runtime.agent.prompt(input.message, {
			...(input.resolvedAttachments?.length ? { attachments: input.resolvedAttachments } : {}),
		});
		void run.then(
			(result) => {
				if (result.isErr()) {
					this.#emitNow(runtime, {
						type: "runtime_error",
						error: { code: result.error.code },
					});
					this.#finishRun(runtime);
					this.#closeIfInvalidated(runtime);
					return;
				}
				const messages = result.value.messages;
				const finish = () => {
					this.#finishRun(runtime);
					const listener = this.#onRunCompleted;
					if (listener) {
						void Promise.resolve(
							listener({
								sessionId: runtime.sessionId,
								firstMessage: input.message,
								messages,
								agent: runtime.agent,
							}),
						)
							.catch(() => {})
							.finally(() => this.#closeIfInvalidated(runtime));
					} else this.#closeIfInvalidated(runtime);
				};
				finish();
			},
			(error) => {
				this.#emitNow(runtime, { type: "runtime_error", error: { code: toErrorEnvelope(error).code } });
				this.#finishRun(runtime);
				this.#closeIfInvalidated(runtime);
			},
		);
		return { accepted: true };
	}

	async rebindSession<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) return operation();
		if (runtime.rebinding) {
			throw desktopAgentError("session_busy", {
				message: `Session "${sessionId}" is already being rebound`,
				data: { sessionId },
			});
		}

		let result!: T;
		const rebinding = this.#rebindRuntime(runtime, async () => {
			result = await operation();
		});
		runtime.rebinding = rebinding;
		try {
			await rebinding;
			return result;
		} finally {
			if (runtime.rebinding === rebinding) runtime.rebinding = undefined;
		}
	}

	abort(sessionId: string): void {
		const runtime = this.#requireSession(sessionId);
		void runtime.agent.abort();
		this.#approvals.cancelSession(sessionId);
		this.#extensionApprovals.cancelSession(sessionId);
	}

	steer(input: DesktopAgentMessageInput): void {
		void this.#requireSession(input.sessionId).agent.steer(input.message);
	}

	followUp(input: DesktopAgentMessageInput): void {
		void this.#requireSession(input.sessionId).agent.followUp(input.message);
	}

	resolvePermission(resolution: { readonly requestId: string; readonly decision: CodingPermissionDecision }): void {
		this.#approvals.resolve(resolution);
	}

	resolveExtensionPermission(resolution: DesktopExtensionPermissionResolution): void {
		this.#extensionApprovals.resolve(resolution);
	}

	getSnapshot(sessionId: string): DesktopAgentSnapshot {
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) return { sessionId, status: "idle", items: [], artifacts: [], lastSeq: 0 };
		return {
			sessionId,
			status: runtime.status,
			items: [...runtime.items.values()].map((item) => structuredClone(item)),
			...(runtime.todos ? { todos: structuredClone(runtime.todos) } : {}),
			artifacts: sortArtifacts(runtime.artifacts.values()).map((artifact) => structuredClone(artifact)),
			lastSeq: runtime.seq,
		};
	}

	getArtifact(sessionId: string, artifactId: string): DesktopArtifact | undefined {
		const artifact = this.#sessions.get(sessionId)?.artifacts.get(artifactId);
		return artifact ? structuredClone(artifact) : undefined;
	}

	closeSession(sessionId: string): void {
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) return;
		runtime.closed = true;
		this.#clearPendingTranscriptUpdates(runtime);
		this.#approvals.cancelSession(sessionId);
		this.#extensionApprovals.cancelSession(sessionId);
		void runtime.agent.close();
		runtime.unsubscribe();
		this.#sessions.delete(sessionId);
	}

	invalidateSessions(): void {
		for (const runtime of [...this.#sessions.values()]) {
			if (runtime.status === "idle") this.closeSession(runtime.sessionId);
			else runtime.invalidateAfterRun = true;
		}
	}

	close(): void {
		for (const sessionId of [...this.#sessions.keys()]) this.closeSession(sessionId);
		this.#approvals.close();
		this.#extensionApprovals.close();
	}

	async #getOrCreate(input: DesktopAgentMessageInput): Promise<SessionRuntime> {
		const existing = this.#sessions.get(input.sessionId);
		if (existing) {
			if (existing.status === "running" || (existing.modelRef === input.modelRef && existing.mode === input.mode)) {
				return existing;
			}
			if (existing.rebinding) await existing.rebinding;
			if (existing.modelRef === input.modelRef && existing.mode === input.mode) return existing;
			const rebinding = this.#rebindRuntime(existing, async () => {
				existing.modelRef = input.modelRef;
				existing.mode = input.mode;
			});
			existing.rebinding = rebinding;
			try {
				await rebinding;
			} finally {
				if (existing.rebinding === rebinding) existing.rebinding = undefined;
			}
			return existing;
		}
		const pending = this.#creating.get(input.sessionId);
		if (pending) return pending;
		if (!this.#factory) {
			throw desktopAgentError("factory_unavailable", {
				message: "Coding Agent provider factory is not configured",
			});
		}

		const creation = this.#createRuntime(input);
		this.#creating.set(input.sessionId, creation);
		try {
			return await creation;
		} finally {
			this.#creating.delete(input.sessionId);
		}
	}

	async #createRuntime(input: DesktopAgentMessageInput): Promise<SessionRuntime> {
		const agent = await this.#createAgent(input.sessionId, input.modelRef, input.mode);
		const todos = projectSessionTodos(agent.state.appState.todos);
		const runtime: SessionRuntime = {
			sessionId: input.sessionId,
			modelRef: input.modelRef,
			mode: input.mode,
			agent,
			items: new Map(),
			artifacts: new Map(),
			unsubscribe: () => {},
			status: "idle",
			...(todos ? { todos } : {}),
			closed: false,
			seq: 0,
			nextMessageId: 1,
			nextCompactionId: 1,
			pendingTranscriptUpdates: new Map(),
			invalidateAfterRun: false,
			pendingRuns: 0,
		};
		runtime.unsubscribe = agent.subscribe((event) => this.#onAgentEvent(runtime, event));
		for (const artifact of agent.state.artifacts) runtime.artifacts.set(artifact.id, artifact);
		this.#sessions.set(input.sessionId, runtime);
		return runtime;
	}

	#createAgent(sessionId: string, modelRef: string, mode: DesktopAgentMode): Promise<CodingAgent> {
		return this.#factory!({
			sessionId,
			modelRef,
			mode,
			requestApproval: (request, signal) => this.#requestApproval(sessionId, request, signal),
			requestExtensionApproval: (request, signal) => this.#requestExtensionApproval(sessionId, request, signal),
		});
	}

	async #rebindRuntime(runtime: SessionRuntime, operation: () => Promise<void>): Promise<void> {
		if (runtime.pendingRuns > 0 || runtime.agent.state.status === "running") {
			await runtime.agent.abort();
			await runtime.agent.waitForIdle();
		}

		await operation();
		let replacement: CodingAgent;
		try {
			replacement = await this.#createAgent(runtime.sessionId, runtime.modelRef, runtime.mode);
		} catch (error) {
			this.closeSession(runtime.sessionId);
			throw error;
		}

		const previous = runtime.agent;
		runtime.unsubscribe();
		runtime.agent = replacement;
		runtime.unsubscribe = replacement.subscribe((event) => this.#onAgentEvent(runtime, event));
		this.#approvals.cancelSession(runtime.sessionId);
		this.#extensionApprovals.cancelSession(runtime.sessionId);
		void previous.close();
	}

	async #requestApproval(
		sessionId: string,
		request: CodingPermissionRequest,
		signal?: AbortSignal,
	): Promise<CodingPermissionDecision> {
		const runtime = this.#requireSession(sessionId);
		const safeRequest = projectPermissionRequest(request);
		const pending = this.#approvals.register(request, signal);
		const item: DesktopPermissionItem = {
			kind: "permission",
			id: `permission:${request.requestId}`,
			request: safeRequest,
			status: "pending",
		};
		runtime.items.set(item.id, item);
		this.#emitNow(runtime, { type: "transcript_upsert", item });
		try {
			const decision = await pending.result;
			const resolved: DesktopPermissionItem = {
				...item,
				status: decision === "deny" ? "denied" : "allowed",
				approvalOrigin: "manual",
			};
			runtime.items.set(item.id, resolved);
			this.#emitNow(runtime, { type: "transcript_upsert", item: resolved });
			return decision;
		} catch (error) {
			if (runtime.closed) throw error;
			const cancelled: DesktopPermissionItem = { ...item, status: "cancelled" };
			runtime.items.set(item.id, cancelled);
			this.#emitNow(runtime, { type: "transcript_upsert", item: cancelled });
			throw error;
		}
	}

	async #requestExtensionApproval(
		sessionId: string,
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	): Promise<CodingExtensionApprovalDecision> {
		const runtime = this.#requireSession(sessionId);
		if (request.sessionId !== sessionId) {
			throw new DesktopAgentSessionNotFound({
				message: `Extension approval session "${request.sessionId}" does not match active session`,
				data: { sessionId: request.sessionId },
			});
		}
		const safeRequest = projectExtensionApprovalRequest(request);
		const pending = this.#extensionApprovals.register(safeRequest, signal);
		const item: DesktopExtensionPermissionItem = {
			kind: "extension_permission",
			id: `extension-permission:${request.requestId}`,
			request: safeRequest,
			status: "pending",
		};
		runtime.items.set(item.id, item);
		this.#emitNow(runtime, { type: "transcript_upsert", item });
		try {
			const decision = await pending.result;
			const resolved: DesktopExtensionPermissionItem = {
				...item,
				status: decision === "deny" ? "denied" : "allowed",
			};
			runtime.items.set(item.id, resolved);
			this.#emitNow(runtime, { type: "transcript_upsert", item: resolved });
			return decision;
		} catch (error) {
			if (runtime.closed) throw error;
			const cancelled: DesktopExtensionPermissionItem = { ...item, status: "cancelled" };
			runtime.items.set(item.id, cancelled);
			this.#emitNow(runtime, { type: "transcript_upsert", item: cancelled });
			throw error;
		}
	}

	#onAgentEvent(runtime: SessionRuntime, event: CodingAgentEvent): void {
		switch (event.type) {
			case "message_start": {
				for (const item of this.#projectMessageItems(runtime, event.message, "streaming")) {
					runtime.items.set(item.id, item);
					this.#emitNow(runtime, { type: "transcript_upsert", item });
				}
				return;
			}
			case "message_update": {
				this.#applyProjection(runtime, projectMessageUpdate(event, this.#projectionContext(runtime)));
				return;
			}
			case "message_end": {
				const completeItems = this.#projectMessageItems(runtime, event.message, "complete");
				const narrationIds = new Set(
					completeItems.filter((item) => item.kind === "narration").map((item) => item.id),
				);
				for (const id of narrationIds) runtime.pendingTranscriptUpdates.delete(id);
				for (const item of completeItems) {
					runtime.items.set(item.id, item);
					if (narrationIds.size > 0) {
						this.#emitEnvelope(runtime, { type: "transcript_upsert", item });
					} else {
						this.#emitNow(runtime, { type: "transcript_upsert", item });
					}
				}
				if (narrationIds.size > 0) this.#flushPendingTranscriptUpdates(runtime);
				this.#onSessionActivity?.(runtime.sessionId);
				if (event.message.role === "assistant") runtime.activeAssistantId = undefined;
				if (event.message.role === "user") runtime.activeUserId = undefined;
				return;
			}
			case "message_discard": {
				this.#discardActiveAssistant(runtime);
				return;
			}
			case "tool_execution_start": {
				this.#applyProjection(runtime, projectToolStart(event, this.#projectionContext(runtime)));
				return;
			}
			case "tool_execution_update":
			case "tool_execution_end": {
				if (event.type === "tool_execution_end") {
					const artifact = runtime.agent.state.artifacts.find(
						(candidate) => candidate.toolCallId === event.toolCallId,
					);
					if (artifact && !event.isError) this.#upsertArtifact(runtime, artifact);
				}
				this.#applyProjection(runtime, projectToolProgress(event, this.#projectionContext(runtime)));
				return;
			}
			case "compaction_start": {
				this.#startCompaction(runtime);
				return;
			}
			case "compaction_end": {
				this.#finishCompaction(runtime, event.outcome);
				return;
			}
			default:
				return;
		}
	}

	#startCompaction(runtime: SessionRuntime): void {
		if (runtime.pendingCompactionId) return;

		const item: DesktopCompactionItem = {
			kind: "compaction",
			id: `compaction:pending:${runtime.nextCompactionId++}`,
			summary: "",
			timestamp: Date.now(),
			status: "compacting",
		};
		runtime.pendingCompactionId = item.id;
		runtime.items.set(item.id, item);
		this.#emitNow(runtime, { type: "transcript_upsert", item });
	}

	#finishCompaction(runtime: SessionRuntime, outcome: unknown): void {
		const pendingId = runtime.pendingCompactionId;
		runtime.pendingCompactionId = undefined;
		if (pendingId) {
			runtime.items.delete(pendingId);
			this.#emitNow(runtime, { type: "transcript_remove", id: pendingId });
		}

		const item = completedCompactionItem(outcome);
		if (!item) return;
		runtime.items.set(item.id, item);
		this.#emitNow(runtime, { type: "transcript_upsert", item });
	}

	#projectionContext(runtime: SessionRuntime): LiveProjectionContext {
		return {
			...(runtime.currentTurnId ? { turnId: runtime.currentTurnId } : {}),
			messageId: (role) => this.#ensureMessageId(runtime, role),
			existing: (id) => runtime.items.get(id),
		};
	}

	/** Stores what the projection decided and emits it on the matching channel. */
	#applyProjection(runtime: SessionRuntime, projection: LiveProjection): void {
		switch (projection.kind) {
			case "none":
				return;
			case "items": {
				for (const item of projection.items) {
					runtime.items.set(item.id, item);
					this.#emitNow(runtime, { type: "transcript_upsert", item });
				}
				return;
			}
			case "streaming": {
				runtime.items.set(projection.item.id, projection.item);
				this.#queueTranscriptUpdate(runtime, { type: "transcript_upsert", item: projection.item });
				return;
			}
			case "todos": {
				const todos = projectSessionTodos(runtime.agent.state.appState.todos);
				if (!todos) return;
				runtime.todos = todos;
				this.#emitNow(runtime, { type: "todos_replace", todos });
				return;
			}
		}
	}

	#projectMessageItems(
		runtime: SessionRuntime,
		message: CodingAgentMessage,
		status: DesktopMessageItem["status"],
	): DesktopAssistantItem[] {
		if (message.role === "toolResult") return [];
		if (message.role === "assistant") {
			const messageId = this.#ensureMessageId(runtime, "assistant");
			const turnId = runtime.currentTurnId ?? messageId;
			return message.content.flatMap((_, contentIndex) => {
				const item = assistantPartItem({ message, messageId, turnId, contentIndex, status });
				if (!item) return [];
				// A tool call re-projected from its assistant message carries only the
				// placeholder category and a running status. The tool_execution_* events
				// are the authority, so an already-projected tool keeps what they resolved.
				if (item.kind === "tool" && runtime.items.get(item.id)?.kind === "tool") return [];
				return [item];
			});
		}
		const id = this.#ensureMessageId(runtime, "user");
		runtime.currentTurnId = id;
		return [userMessageItem({ id, message, status })];
	}

	#ensureMessageId(runtime: SessionRuntime, role: "assistant" | "user"): string {
		if (role === "assistant") {
			const id = runtime.activeAssistantId ?? `message:${runtime.nextMessageId++}`;
			runtime.activeAssistantId = id;
			return id;
		}
		const id = runtime.activeUserId ?? `message:${runtime.nextMessageId++}`;
		runtime.activeUserId = id;
		return id;
	}

	/**
	 * Drops everything an abandoned assistant attempt streamed. The retry opens a
	 * new message rather than continuing this one, so its items must leave the
	 * transcript instead of lingering above the replacement.
	 */
	#discardActiveAssistant(runtime: SessionRuntime): void {
		const messageId = runtime.activeAssistantId;
		if (!messageId) return;
		const discarded = [...runtime.items.values()].filter(
			(item) => item.id === messageId || item.id.startsWith(`${messageId}:`),
		);
		for (const item of discarded) {
			runtime.pendingTranscriptUpdates.delete(item.id);
			runtime.items.delete(item.id);
		}
		runtime.activeAssistantId = undefined;
		for (const item of discarded) this.#emitNow(runtime, { type: "transcript_remove", id: item.id });
	}

	#queueTranscriptUpdate(
		runtime: SessionRuntime,
		event: Extract<DesktopAgentEvent, { readonly type: "transcript_upsert" }>,
	): void {
		runtime.pendingTranscriptUpdates.set(event.item.id, event);
		if (runtime.flushTimer) return;
		runtime.flushTimer = setTimeout(() => this.#flushPendingTranscriptUpdates(runtime), 100);
		runtime.flushTimer.unref?.();
	}

	#flushPendingTranscriptUpdates(runtime: SessionRuntime): void {
		if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
		runtime.flushTimer = undefined;
		const events = [...runtime.pendingTranscriptUpdates.values()];
		runtime.pendingTranscriptUpdates.clear();
		for (const event of events) this.#emitEnvelope(runtime, event);
	}

	#clearPendingTranscriptUpdates(runtime: SessionRuntime): void {
		if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
		runtime.flushTimer = undefined;
		runtime.pendingTranscriptUpdates.clear();
	}

	#emitNow(runtime: SessionRuntime, event: DesktopAgentEvent): void {
		this.#flushPendingTranscriptUpdates(runtime);
		this.#emitEnvelope(runtime, event);
	}

	#emitEnvelope(runtime: SessionRuntime, event: DesktopAgentEvent): void {
		if (runtime.closed) return;
		runtime.seq++;
		this.#emit({ sessionId: runtime.sessionId, seq: runtime.seq, event: structuredClone(event) });
	}

	#finishRun(runtime: SessionRuntime): void {
		if (runtime.closed) return;
		runtime.pendingRuns = Math.max(0, runtime.pendingRuns - 1);
		if (runtime.pendingRuns > 0) return;
		runtime.status = "idle";
		this.#emitNow(runtime, { type: "status", status: "idle" });
	}

	#upsertArtifact(runtime: SessionRuntime, artifact: DesktopArtifact): void {
		const current = runtime.artifacts.get(artifact.id);
		if (current && current.updatedAt > artifact.updatedAt) return;
		runtime.artifacts.set(artifact.id, artifact);
		this.#emitNow(runtime, { type: "artifact_upsert", artifact });
	}

	#closeIfInvalidated(runtime: SessionRuntime): void {
		if (
			runtime.invalidateAfterRun &&
			runtime.status === "idle" &&
			this.#sessions.get(runtime.sessionId) === runtime
		) {
			this.closeSession(runtime.sessionId);
		}
	}

	#requireSession(sessionId: string): SessionRuntime {
		const runtime = this.#sessions.get(sessionId);
		if (runtime) return runtime;
		throw desktopAgentError("session_not_found", {
			message: `Session "${sessionId}" is not active`,
			data: { sessionId },
		});
	}
}

/**
 * Drops the raw tool arguments; the SDK already decided what is safe to show,
 * including the risk its Danger Layer classified.
 */
function projectPermissionRequest(request: CodingPermissionRequest): DesktopPermissionItem["request"] {
	return {
		requestId: request.requestId,
		sessionId: request.sessionId,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		reason: request.reason,
		canAlwaysAllow: request.canAlwaysAllow,
		summary: request.summary,
		...(request.suggestedRule ? { suggestedRule: request.suggestedRule } : {}),
		...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
	};
}

function projectExtensionApprovalRequest(request: CodingExtensionApprovalRequest): DesktopExtensionApprovalRequest {
	return {
		requestId: request.requestId,
		extensionId: request.extensionId,
		operationId: request.operationId,
		sessionId: request.sessionId,
		toolCallId: request.toolCallId,
		reason: request.reason,
		sideEffect: request.sideEffect,
		dataSensitivity: request.dataSensitivity,
		presentation: {
			title: request.presentation.title,
			...(request.presentation.description ? { description: request.presentation.description } : {}),
			...(request.presentation.attributes
				? {
						attributes: request.presentation.attributes.map((attribute) => ({
							label: attribute.label,
							value: attribute.value,
						})),
					}
				: {}),
		},
		...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
	};
}
