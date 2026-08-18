import type {
	CodingAgent,
	CodingAgentEvent,
	CodingAgentMessage,
	CodingAttachment,
	CodingConnectorApprovalDecision,
	CodingConnectorApprovalRequest,
	CodingPermissionDecision,
	CodingPermissionRequest,
} from "@jai/coding-agent";
import { codingAgentToolNames } from "@jai/coding-agent";
import { PermissionApprovalRegistry } from "@jai/coding-agent/permissions";
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
	DesktopConnectorApprovalRequest,
	DesktopConnectorPermissionItem,
	DesktopConnectorPermissionResolution,
	DesktopMessageItem,
	DesktopNarrationItem,
	DesktopPermissionItem,
	DesktopSubagentItem,
	DesktopThinkingItem,
	DesktopTodos,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { sortArtifacts } from "./artifacts";
import { projectAssistantPart } from "./assistant-projector";
import { projectMessageAttachments, projectSessionTodos, projectSlashInvocation } from "./projector";

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
	readonly requestConnectorApproval: (
		request: CodingConnectorApprovalRequest,
		signal?: AbortSignal,
	) => Promise<CodingConnectorApprovalDecision>;
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
	invalidateAfterRun: boolean;
	pendingRuns: number;
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
	readonly #approvals = new PermissionApprovalRegistry<CodingPermissionRequest, CodingPermissionDecision>();
	readonly #connectorApprovals = new PermissionApprovalRegistry<
		CodingConnectorApprovalRequest,
		CodingConnectorApprovalDecision
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
		const run = runtime.agent.prompt({
			prompt: input.message,
			...(input.resolvedAttachments?.length ? { attachments: input.resolvedAttachments } : {}),
		});
		void run.then(
			(result) => {
				if (result.isErr()) {
					this.#emitNow(runtime, {
						type: "runtime_error",
						error: { code: result.error.code, message: result.error.message },
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
				this.#emitNow(runtime, { type: "runtime_error", error: toErrorEnvelope(error) });
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
		this.#connectorApprovals.cancelSession(sessionId);
	}

	steer(input: DesktopAgentMessageInput): void {
		void this.#requireSession(input.sessionId).agent.steer({ prompt: input.message });
	}

	followUp(input: DesktopAgentMessageInput): void {
		void this.#requireSession(input.sessionId).agent.followUp({ prompt: input.message });
	}

	resolvePermission(resolution: { readonly requestId: string; readonly decision: CodingPermissionDecision }): void {
		this.#approvals.resolve(resolution);
	}

	resolveConnectorPermission(resolution: DesktopConnectorPermissionResolution): void {
		this.#connectorApprovals.resolve({
			requestId: resolution.requestId,
			decision: resolution.decision,
		});
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
		this.#connectorApprovals.cancelSession(sessionId);
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
		this.#connectorApprovals.close();
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
			requestConnectorApproval: (request, signal) => this.#requestConnectorApproval(sessionId, request, signal),
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
		this.#connectorApprovals.cancelSession(runtime.sessionId);
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

	async #requestConnectorApproval(
		sessionId: string,
		request: CodingConnectorApprovalRequest,
		signal?: AbortSignal,
	): Promise<CodingConnectorApprovalDecision> {
		const runtime = this.#requireSession(sessionId);
		const safeRequest: DesktopConnectorApprovalRequest = {
			requestId: request.requestId,
			sessionId,
			toolCallId: request.toolCallId,
			toolName: request.toolName,
			actionId: request.actionId,
			reason: request.reason,
			sideEffect: request.sideEffect,
			dataSensitivity: request.dataSensitivity,
			inputKeys: [...request.inputKeys],
			expiresAt: request.expiresAt,
		};
		const pending = this.#connectorApprovals.register(safeRequest, signal);
		const item: DesktopConnectorPermissionItem = {
			kind: "connector_permission",
			id: `connector-permission:${request.requestId}`,
			request: safeRequest,
			status: "pending",
		};
		runtime.items.set(item.id, item);
		this.#emitNow(runtime, { type: "transcript_upsert", item });
		try {
			const decision = await pending.result;
			const resolved: DesktopConnectorPermissionItem = {
				...item,
				status: decision === "deny" ? "denied" : "allowed",
			};
			runtime.items.set(item.id, resolved);
			this.#emitNow(runtime, { type: "transcript_upsert", item: resolved });
			return decision;
		} catch (error) {
			if (runtime.closed) throw error;
			const cancelled: DesktopConnectorPermissionItem = { ...item, status: "cancelled" };
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
				if (!("contentIndex" in event.assistantEvent)) return;
				const thinkingComplete = event.assistantEvent.type === "thinking_end";
				const messageId = this.#ensureMessageId(runtime, "assistant");
				const item = projectAssistantPart({
					message: event.message,
					messageId,
					turnId: runtime.currentTurnId ?? messageId,
					contentIndex: event.assistantEvent.contentIndex,
					status: thinkingComplete ? "complete" : "streaming",
				});
				if (!item) return;
				if (item.kind === "tool") return;
				runtime.items.set(item.id, item);
				if (thinkingComplete) {
					this.#emitNow(runtime, { type: "transcript_upsert", item });
				} else {
					this.#queueTranscriptUpdate(runtime, { type: "transcript_upsert", item });
				}
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
			case "tool_execution_start": {
				if (event.toolName === codingAgentToolNames.updateTodos) return;
				if (event.toolName === codingAgentToolNames.spawnAgent) {
					const previous = runtime.items.get(`subagent:${event.toolCallId}`);
					const previousSubagent = previous?.kind === "subagent" ? previous : undefined;
					const title =
						(isRecord(event.args) ? stringArgument(event.args, "title") : undefined) ?? previousSubagent?.title;
					if (!title) return;
					const item: DesktopSubagentItem = {
						kind: "subagent",
						id: `subagent:${event.toolCallId}`,
						turnId: previousSubagent?.turnId ?? `subagent:${event.toolCallId}`,
						toolCallId: event.toolCallId,
						title,
						status: "running",
						...(previousSubagent?.activityTitle ? { activityTitle: previousSubagent.activityTitle } : {}),
					};
					runtime.items.set(item.id, item);
					this.#emitNow(runtime, { type: "transcript_upsert", item });
					return;
				}
				const previous = runtime.items.get(`tool:${event.toolCallId}`);
				const previousTool = previous?.kind === "tool" ? previous : undefined;
				const item: DesktopToolItem = {
					kind: "tool",
					id: `tool:${event.toolCallId}`,
					turnId: previousTool?.turnId ?? `tool:${event.toolCallId}`,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: "running",
					summary: summarizeToolArguments(event.toolName, event.args),
				};
				runtime.items.set(item.id, item);
				this.#emitNow(runtime, { type: "transcript_upsert", item });
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
				if (event.toolName === codingAgentToolNames.updateTodos) {
					if (event.type === "tool_execution_end" && !event.isError) {
						const todos = projectSessionTodos(runtime.agent.state.appState.todos);
						if (todos) {
							runtime.todos = todos;
							this.#emitNow(runtime, { type: "todos_replace", todos });
						}
					}
					return;
				}
				if (event.toolName === codingAgentToolNames.spawnAgent) {
					const previous = runtime.items.get(`subagent:${event.toolCallId}`);
					const previousSubagent = previous?.kind === "subagent" ? previous : undefined;
					const result = event.type === "tool_execution_update" ? event.partial : event.result;
					const details = projectSpawnAgentDetails(isRecord(result) ? result.details : undefined);
					const title = details?.title ?? previousSubagent?.title;
					if (!title) return;
					const status =
						event.type === "tool_execution_update"
							? (details?.status ?? "running")
							: event.isError
								? "error"
								: "complete";
					const activityTitle = details?.activityTitle ?? previousSubagent?.activityTitle;
					const item: DesktopSubagentItem = {
						kind: "subagent",
						id: `subagent:${event.toolCallId}`,
						turnId: previousSubagent?.turnId ?? `subagent:${event.toolCallId}`,
						toolCallId: event.toolCallId,
						title,
						status,
						...(activityTitle ? { activityTitle } : {}),
					};
					runtime.items.set(item.id, item);
					this.#emitNow(runtime, { type: "transcript_upsert", item });
					return;
				}
				const previous = runtime.items.get(`tool:${event.toolCallId}`);
				const previousTool = previous?.kind === "tool" ? previous : undefined;
				const result = event.type === "tool_execution_update" ? event.partial : event.result;
				const details = toolResultText(result, 20_000);
				const item: DesktopToolItem = {
					kind: "tool",
					id: `tool:${event.toolCallId}`,
					turnId: previousTool?.turnId ?? `tool:${event.toolCallId}`,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: event.type === "tool_execution_update" ? "running" : "complete",
					summary: previousTool?.summary ?? (details ? truncate(details, 500) : undefined),
					...(details ? { details } : previousTool?.details ? { details: previousTool.details } : {}),
				};
				runtime.items.set(item.id, item);
				this.#emitNow(runtime, { type: "transcript_upsert", item });
				return;
			}
			default:
				return;
		}
	}

	#projectMessageItems(
		runtime: SessionRuntime,
		message: CodingAgentMessage,
		status: DesktopMessageItem["status"],
	): (DesktopMessageItem | DesktopNarrationItem | DesktopThinkingItem | DesktopToolItem | DesktopSubagentItem)[] {
		if (message.role === "toolResult") return [];
		if (message.role === "assistant") {
			const messageId = this.#ensureMessageId(runtime, "assistant");
			const turnId = runtime.currentTurnId ?? messageId;
			return message.content.flatMap((_, contentIndex) => {
				const item = projectAssistantPart({ message, messageId, turnId, contentIndex, status });
				return item ? [item] : [];
			});
		}
		const id = this.#ensureMessageId(runtime, "user");
		runtime.currentTurnId = id;
		const slashInvocation = projectSlashInvocation(message);
		const attachments = projectMessageAttachments(message);
		return [
			{
				kind: "message",
				id,
				role: message.role,
				text: messageText(message),
				status,
				timestamp: message.timestamp,
				...(slashInvocation ? { slashInvocation } : {}),
				...(attachments ? { attachments } : {}),
			},
		];
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

function projectPermissionRequest(request: CodingPermissionRequest): DesktopPermissionItem["request"] {
	return {
		requestId: request.requestId,
		sessionId: request.sessionId,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		reason: request.reason,
		canAlwaysAllow: request.canAlwaysAllow,
		summary: permissionSummary(request),
		...(request.suggestedRule ? { suggestedRule: request.suggestedRule } : {}),
		...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
	};
}

function permissionSummary(request: CodingPermissionRequest): DesktopPermissionItem["request"]["summary"] {
	const path = stringArgument(request.args, "path");
	const command = request.toolName === "Bash" ? stringArgument(request.args, "command") : undefined;
	return {
		title: `${request.toolName} requests permission`,
		...(path ? { path } : {}),
		...(command ? { command } : {}),
		risk:
			request.toolName === "Bash" || request.toolName === "Write" || request.toolName === "Edit" ? "high" : "medium",
	};
}

function summarizeToolArguments(toolName: string, args: unknown): string | undefined {
	if (!isRecord(args)) return undefined;
	const command = toolName === "Bash" ? stringArgument(args, "command") : undefined;
	const skill = toolName === "Skill" ? stringArgument(args, "skill") : undefined;
	const path = stringArgument(args, "path");
	return truncate(command ?? (skill ? `/${skill}` : undefined) ?? path ?? toolName, 240);
}

function toolResultText(result: unknown, maxLength: number): string | undefined {
	if (!isRecord(result) || !Array.isArray(result.content)) return undefined;
	const text = result.content
		.filter(
			(part): part is { type: "text"; text: string } =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n");
	return text ? truncate(text, maxLength) : undefined;
}

function projectSpawnAgentDetails(
	value: unknown,
):
	| { readonly title: string; readonly status: "running" | "complete" | "error"; readonly activityTitle?: string }
	| undefined {
	if (!isRecord(value)) return undefined;
	const title = stringArgument(value, "title");
	const status = value.status;
	if (!title || (status !== "running" && status !== "complete" && status !== "error")) return undefined;
	const activityTitle = stringArgument(value, "activityTitle");
	return { title, status, ...(activityTitle ? { activityTitle } : {}) };
}

function messageText(message: CodingAgentMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.flatMap((part) => {
			if (part.type === "text") return [part.text];
			return [];
		})
		.join("");
}

function stringArgument(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value ? value : undefined;
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
