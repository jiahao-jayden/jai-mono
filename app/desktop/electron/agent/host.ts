import type { AgentEvent, AgentEventListener, AgentMessage } from "@jai/agent";
import type { CodingMessageAttachment } from "@jai/coding";
import type { ConnectorApprovalDecision, ConnectorApprovalRequest } from "@jai/coding/connector";
import {
	type PermissionApprovalDecision,
	PermissionApprovalRegistry,
	type PermissionApprovalRequest,
	type PermissionRequest,
	type PermissionResolution,
} from "@jai/coding/permissions";
import { SPAWN_AGENT_TOOL_NAME, type SpawnAgentToolDetails, UPDATE_TODOS_TOOL_NAME } from "@jai/coding/tools";
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
import { artifactCatalog, projectArtifact, projectArtifactCatalog, sortArtifacts } from "./artifacts";
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

export interface HostedCodingAgent {
	getAppState?(): unknown;
	updateAppState?(update: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
	invoke(input: string): Promise<AgentMessage[]>;
	invokeWithAttachments?(input: {
		readonly text: string;
		readonly attachments: readonly CodingMessageAttachment[];
	}): Promise<AgentMessage[]>;
	generateTitle?(firstMessage: string, messages: readonly AgentMessage[]): Promise<string>;
	subscribe(listener: AgentEventListener): () => void;
	waitForIdle(): Promise<void>;
	abort(): void;
	steer(message: AgentMessage): void;
	followUp(message: AgentMessage): void;
	close(): void;
}

export interface DesktopAgentSendInput extends DesktopAgentMessageInput {
	readonly resolvedAttachments?: readonly CodingMessageAttachment[];
}

export interface DesktopAgentFactoryContext {
	readonly sessionId: string;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
	readonly requestApproval: (
		request: PermissionApprovalRequest,
		signal?: AbortSignal,
	) => Promise<PermissionApprovalDecision>;
	readonly requestConnectorApproval: (
		request: ConnectorApprovalRequest,
		signal?: AbortSignal,
	) => Promise<ConnectorApprovalDecision>;
}

export type DesktopAgentFactory = (context: DesktopAgentFactoryContext) => Promise<HostedCodingAgent>;
export type DesktopAgentEventSink = (envelope: DesktopAgentEventEnvelope) => void;
export interface DesktopRunCompletedContext {
	readonly sessionId: string;
	readonly firstMessage: string;
	readonly messages: readonly AgentMessage[];
	readonly agent: HostedCodingAgent;
}

interface SessionRuntime {
	readonly sessionId: string;
	modelRef: string;
	mode: DesktopAgentMode;
	agent: HostedCodingAgent;
	readonly items: Map<string, DesktopTranscriptItem>;
	readonly artifacts: Map<string, DesktopArtifact>;
	readonly pendingArtifacts: Map<string, DesktopArtifact>;
	appStateWrites?: Promise<void>;
	unsubscribe: () => void;
	status: DesktopAgentStatus;
	todos?: DesktopTodos;
	closed: boolean;
	seq: number;
	nextMessageId: number;
	safeBoundary: number;
	readonly activeToolCallIds: Set<string>;
	readonly pendingToolResultIds: Set<string>;
	readonly safeBoundaryWaiters: Set<{ readonly after: number; readonly resolve: () => void }>;
	invalidateAfterRun: boolean;
	runCompletion?: Promise<void>;
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
	readonly #approvals = new PermissionApprovalRegistry();
	readonly #connectorApprovals = new PermissionApprovalRegistry<
		DesktopConnectorApprovalRequest,
		ConnectorApprovalDecision
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
		if (runtime.status === "running") {
			throw desktopAgentError("session_busy", {
				message: `Session "${input.sessionId}" is already running`,
				data: { sessionId: input.sessionId },
			});
		}
		runtime.status = "running";
		this.#emitNow(runtime, { type: "status", status: "running" });
		const run =
			input.resolvedAttachments && input.resolvedAttachments.length > 0 && runtime.agent.invokeWithAttachments
				? runtime.agent.invokeWithAttachments({ text: input.message, attachments: input.resolvedAttachments })
				: runtime.agent.invoke(input.message);
		const completed = run.then(
			(messages) => {
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
				const pendingAppStateWrite = runtime.appStateWrites;
				if (pendingAppStateWrite) {
					return pendingAppStateWrite.then(finish, finish);
				}
				finish();
			},
			(error) => {
				this.#emitNow(runtime, { type: "runtime_error", error: toErrorEnvelope(error) });
				this.#finishRun(runtime);
				this.#closeIfInvalidated(runtime);
			},
		);
		const runCompletion = completed.finally(() => {
			if (runtime.runCompletion === runCompletion) runtime.runCompletion = undefined;
		});
		runtime.runCompletion = runCompletion;
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
		runtime.agent.abort();
		this.#approvals.cancelSession(sessionId);
		this.#connectorApprovals.cancelSession(sessionId);
	}

	steer(input: DesktopAgentMessageInput): void {
		this.#requireSession(input.sessionId).agent.steer(userMessage(input.message));
	}

	followUp(input: DesktopAgentMessageInput): void {
		this.#requireSession(input.sessionId).agent.followUp(userMessage(input.message));
	}

	resolvePermission(resolution: PermissionResolution): void {
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
		this.#markSafeBoundary(runtime);
		this.#clearPendingTranscriptUpdates(runtime);
		this.#approvals.cancelSession(sessionId);
		this.#connectorApprovals.cancelSession(sessionId);
		runtime.agent.close();
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
		const appState = agent.getAppState?.();
		const appStateRecord = isRecord(appState) ? appState : undefined;
		const todos = projectSessionTodos(appStateRecord?.todos);
		const runtime: SessionRuntime = {
			sessionId: input.sessionId,
			modelRef: input.modelRef,
			mode: input.mode,
			agent,
			items: new Map(),
			artifacts: new Map(),
			pendingArtifacts: new Map(),
			unsubscribe: () => {},
			status: "idle",
			...(todos ? { todos } : {}),
			closed: false,
			seq: 0,
			nextMessageId: 1,
			safeBoundary: 0,
			activeToolCallIds: new Set(),
			pendingToolResultIds: new Set(),
			safeBoundaryWaiters: new Set(),
			pendingTranscriptUpdates: new Map(),
			invalidateAfterRun: false,
		};
		runtime.unsubscribe = agent.subscribe((event) => this.#onAgentEvent(runtime, event));
		for (const artifact of projectArtifactCatalog(appStateRecord?.artifacts))
			runtime.artifacts.set(artifact.id, artifact);
		this.#sessions.set(input.sessionId, runtime);
		return runtime;
	}

	#createAgent(sessionId: string, modelRef: string, mode: DesktopAgentMode): Promise<HostedCodingAgent> {
		return this.#factory!({
			sessionId,
			modelRef,
			mode,
			requestApproval: (request, signal) => this.#requestApproval(sessionId, request, signal),
			requestConnectorApproval: (request, signal) => this.#requestConnectorApproval(sessionId, request, signal),
		});
	}

	async #rebindRuntime(runtime: SessionRuntime, operation: () => Promise<void>): Promise<void> {
		if (runtime.status === "running") {
			await this.#waitForSafeBoundary(runtime);
			if (runtime.status === "running") runtime.agent.abort();
			await (runtime.runCompletion ?? runtime.agent.waitForIdle());
		}

		await operation();
		let replacement: HostedCodingAgent;
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
		runtime.activeToolCallIds.clear();
		runtime.pendingToolResultIds.clear();
		this.#approvals.cancelSession(runtime.sessionId);
		this.#connectorApprovals.cancelSession(runtime.sessionId);
		previous.close();
	}

	#waitForSafeBoundary(runtime: SessionRuntime): Promise<void> {
		if (runtime.status !== "running") return Promise.resolve();
		const after = runtime.safeBoundary;
		return new Promise((resolve) => {
			runtime.safeBoundaryWaiters.add({ after, resolve });
		});
	}

	async #requestApproval(
		sessionId: string,
		request: PermissionApprovalRequest,
		signal?: AbortSignal,
	): Promise<PermissionApprovalDecision> {
		const runtime = this.#requireSession(sessionId);
		const safeRequest = projectPermissionRequest(sessionId, request);
		const pending = this.#approvals.register(safeRequest, signal);
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
		request: ConnectorApprovalRequest,
		signal?: AbortSignal,
	): Promise<ConnectorApprovalDecision> {
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

	#onAgentEvent(runtime: SessionRuntime, event: AgentEvent): void {
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
				if (event.message.role === "assistant" && isExecutableAssistantMessage(event.message)) {
					for (const part of event.message.content) {
						if (part.type === "toolCall") runtime.pendingToolResultIds.add(part.id);
					}
				}
				if (event.message.role === "toolResult") {
					runtime.pendingToolResultIds.delete(event.message.toolCallId);
				}
				if (event.message.role !== "user") this.#markSafeBoundaryIfReady(runtime);
				return;
			}
			case "tool_execution_start": {
				const artifact = projectArtifact(event.toolName, event.args, event.toolCallId, Date.now());
				if (artifact) runtime.pendingArtifacts.set(event.toolCallId, artifact);
				if (event.toolName === UPDATE_TODOS_TOOL_NAME) return;
				if (event.toolName === SPAWN_AGENT_TOOL_NAME) {
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
				runtime.activeToolCallIds.add(event.toolCallId);
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
					const artifact = runtime.pendingArtifacts.get(event.toolCallId);
					runtime.pendingArtifacts.delete(event.toolCallId);
					if (artifact && !event.isError) {
						this.#upsertArtifact(runtime, artifact);
					}
				}
				if (event.toolName === UPDATE_TODOS_TOOL_NAME) {
					if (event.type === "tool_execution_end" && !event.isError) {
						const details = isRecord(event.result.details) ? event.result.details : undefined;
						const todos = projectSessionTodos(details?.todos);
						if (todos) {
							runtime.todos = todos;
							this.#emitNow(runtime, { type: "todos_replace", todos });
						}
					}
					return;
				}
				if (event.toolName === SPAWN_AGENT_TOOL_NAME) {
					const previous = runtime.items.get(`subagent:${event.toolCallId}`);
					const previousSubagent = previous?.kind === "subagent" ? previous : undefined;
					const result = event.type === "tool_execution_update" ? event.partial : event.result;
					const details = projectSpawnAgentDetails(result.details);
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
				if (event.type === "tool_execution_end") runtime.activeToolCallIds.delete(event.toolCallId);
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
					status: event.type === "tool_execution_update" ? "running" : event.isError ? "error" : "complete",
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
		message: AgentMessage,
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
		runtime.status = "idle";
		runtime.activeToolCallIds.clear();
		runtime.pendingToolResultIds.clear();
		this.#markSafeBoundary(runtime);
		this.#emitNow(runtime, { type: "status", status: "idle" });
	}

	#upsertArtifact(runtime: SessionRuntime, artifact: DesktopArtifact): void {
		const current = runtime.artifacts.get(artifact.id);
		if (current && current.updatedAt > artifact.updatedAt) return;
		runtime.artifacts.set(artifact.id, artifact);
		this.#emitNow(runtime, { type: "artifact_upsert", artifact });
		if (!runtime.agent.updateAppState) return;
		const write = (runtime.appStateWrites ?? Promise.resolve()).then(() =>
			runtime.agent.updateAppState!((currentState) => {
				const items = new Map(projectArtifactCatalog(currentState.artifacts).map((item) => [item.id, item]));
				const previous = items.get(artifact.id);
				if (!previous || artifact.updatedAt >= previous.updatedAt) items.set(artifact.id, artifact);
				return { ...currentState, artifacts: artifactCatalog(items.values()) };
			}),
		);
		runtime.appStateWrites = write.catch(() => {});
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

	#markSafeBoundaryIfReady(runtime: SessionRuntime): void {
		if (runtime.activeToolCallIds.size === 0 && runtime.pendingToolResultIds.size === 0) {
			this.#markSafeBoundary(runtime);
		}
	}

	#markSafeBoundary(runtime: SessionRuntime): void {
		runtime.safeBoundary++;
		for (const waiter of [...runtime.safeBoundaryWaiters]) {
			if (waiter.after >= runtime.safeBoundary) continue;
			runtime.safeBoundaryWaiters.delete(waiter);
			waiter.resolve();
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

function userMessage(content: string): AgentMessage {
	return { role: "user", content, timestamp: Date.now() };
}

function isExecutableAssistantMessage(message: AgentMessage): message is Extract<AgentMessage, { role: "assistant" }> {
	return (
		message.role === "assistant" &&
		message.stopReason !== "error" &&
		message.stopReason !== "aborted" &&
		message.stopReason !== "contextOverflow"
	);
}

function projectPermissionRequest(sessionId: string, request: PermissionApprovalRequest): PermissionRequest {
	return {
		requestId: request.requestId,
		sessionId,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		reason: request.reason,
		canAlwaysAllow: request.canAlwaysAllow,
		summary: permissionSummary(request),
		...(request.suggestedRule ? { suggestedRule: request.suggestedRule } : {}),
		...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
	};
}

function permissionSummary(request: PermissionApprovalRequest): PermissionRequest["summary"] {
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

function toolResultText(result: { content: readonly unknown[] }, maxLength: number): string | undefined {
	const text = result.content
		.filter(
			(part): part is { type: "text"; text: string } =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n");
	return text ? truncate(text, maxLength) : undefined;
}

function projectSpawnAgentDetails(value: unknown): SpawnAgentToolDetails | undefined {
	if (!isRecord(value)) return undefined;
	const title = stringArgument(value, "title");
	const status = value.status;
	if (!title || (status !== "running" && status !== "complete" && status !== "error")) return undefined;
	const activityTitle = stringArgument(value, "activityTitle");
	return { title, status, ...(activityTitle ? { activityTitle } : {}) };
}

function messageText(message: AgentMessage): string {
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
