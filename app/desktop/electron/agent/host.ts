import type { AgentEvent, AgentEventListener, AgentMessage } from "@jai/agent";
import {
	type PermissionApprovalDecision,
	PermissionApprovalRegistry,
	type PermissionApprovalRequest,
	type PermissionRequest,
	type PermissionResolution,
} from "@jai/coding/permissions";
import { REPORT_PROGRESS_TOOL_NAME } from "@jai/coding/tools";
import { toErrorEnvelope } from "@jai/common";
import { TaggedError } from "better-result";
import type {
	DesktopAgentEvent,
	DesktopAgentEventEnvelope,
	DesktopAgentMessageInput,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopMessageItem,
	DesktopPermissionItem,
	DesktopProgressItem,
	DesktopThinkingItem,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { projectSlashInvocation } from "./projector";

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
	invoke(input: string): Promise<AgentMessage[]>;
	generateTitle?(firstMessage: string, messages: readonly AgentMessage[]): Promise<string>;
	subscribe(listener: AgentEventListener): () => void;
	waitForIdle(): Promise<void>;
	abort(): void;
	steer(message: AgentMessage): void;
	followUp(message: AgentMessage): void;
	close(): void;
}

export interface DesktopAgentFactoryContext {
	readonly sessionId: string;
	readonly modelRef: string;
	readonly requestApproval: (
		request: PermissionApprovalRequest,
		signal?: AbortSignal,
	) => Promise<PermissionApprovalDecision>;
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
	agent: HostedCodingAgent;
	readonly items: Map<string, DesktopTranscriptItem>;
	unsubscribe: () => void;
	status: DesktopAgentStatus;
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

	async send(input: DesktopAgentMessageInput): Promise<{ readonly accepted: true }> {
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
		const run = runtime.agent.invoke(input.message).then(
			(messages) => {
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
			},
			(error) => {
				this.#emitNow(runtime, { type: "runtime_error", error: toErrorEnvelope(error) });
				this.#finishRun(runtime);
				this.#closeIfInvalidated(runtime);
			},
		);
		const runCompletion = run.finally(() => {
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

	getSnapshot(sessionId: string): DesktopAgentSnapshot {
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) return { sessionId, status: "idle", items: [], lastSeq: 0 };
		return {
			sessionId,
			status: runtime.status,
			items: [...runtime.items.values()].map((item) => structuredClone(item)),
			lastSeq: runtime.seq,
		};
	}

	closeSession(sessionId: string): void {
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) return;
		runtime.closed = true;
		this.#markSafeBoundary(runtime);
		this.#clearPendingTranscriptUpdates(runtime);
		this.#approvals.cancelSession(sessionId);
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
	}

	async #getOrCreate(input: DesktopAgentMessageInput): Promise<SessionRuntime> {
		const existing = this.#sessions.get(input.sessionId);
		if (existing) {
			if (existing.status === "running" || existing.modelRef === input.modelRef) return existing;
			if (existing.rebinding) await existing.rebinding;
			if (existing.modelRef === input.modelRef) return existing;
			const rebinding = this.#rebindRuntime(existing, async () => {
				existing.modelRef = input.modelRef;
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
		const agent = await this.#createAgent(input.sessionId, input.modelRef);
		const runtime: SessionRuntime = {
			sessionId: input.sessionId,
			modelRef: input.modelRef,
			agent,
			items: new Map(),
			unsubscribe: () => {},
			status: "idle",
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
		this.#sessions.set(input.sessionId, runtime);
		return runtime;
	}

	#createAgent(sessionId: string, modelRef: string): Promise<HostedCodingAgent> {
		return this.#factory!({
			sessionId,
			modelRef,
			requestApproval: (request, signal) => this.#requestApproval(sessionId, request, signal),
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
			replacement = await this.#createAgent(runtime.sessionId, runtime.modelRef);
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
				const item = this.#projectAssistantPart(
					runtime,
					event.message,
					event.assistantEvent.contentIndex,
					"streaming",
				);
				if (!item) return;
				if (item.kind === "tool" || item.kind === "progress") return;
				runtime.items.set(item.id, item);
				this.#queueTranscriptUpdate(runtime, { type: "transcript_upsert", item });
				return;
			}
			case "message_end": {
				for (const item of this.#projectMessageItems(runtime, event.message, "complete")) {
					runtime.items.set(item.id, item);
					this.#emitNow(runtime, { type: "transcript_upsert", item });
				}
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
				if (event.toolName === REPORT_PROGRESS_TOOL_NAME) return;
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
				if (event.toolName === REPORT_PROGRESS_TOOL_NAME) return;
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
	): (DesktopMessageItem | DesktopThinkingItem | DesktopProgressItem | DesktopToolItem)[] {
		if (message.role === "toolResult") return [];
		if (message.role === "assistant") {
			this.#ensureMessageId(runtime, "assistant");
			const progress = message.content.find(
				(part) => part.type === "toolCall" && part.name === REPORT_PROGRESS_TOOL_NAME,
			);
			if (progress?.type === "toolCall") runtime.currentTurnId = `progress:${progress.id}`;
			let textProjected = false;
			return message.content.flatMap((_, contentIndex) => {
				const item = this.#projectAssistantPart(runtime, message, contentIndex, status);
				if (item?.kind === "message") {
					if (textProjected) return [];
					textProjected = true;
				}
				return item ? [item] : [];
			});
		}
		const id = this.#ensureMessageId(runtime, "user");
		runtime.currentTurnId = id;
		const slashInvocation = projectSlashInvocation(message);
		return [
			{
				kind: "message",
				id,
				role: message.role,
				text: messageText(message),
				status,
				timestamp: message.timestamp,
				...(slashInvocation ? { slashInvocation } : {}),
			},
		];
	}

	#projectAssistantPart(
		runtime: SessionRuntime,
		message: Extract<AgentMessage, { role: "assistant" }>,
		contentIndex: number,
		status: DesktopMessageItem["status"],
	): DesktopMessageItem | DesktopThinkingItem | DesktopProgressItem | DesktopToolItem | undefined {
		const id = this.#ensureMessageId(runtime, "assistant");
		const turnId = runtime.currentTurnId ?? id;
		const part = message.content[contentIndex];
		if (!part) return undefined;
		if (part.type === "thinking") {
			if (!part.thinking) return undefined;
			return {
				kind: "thinking",
				id: `thinking:${id}:${contentIndex}`,
				turnId,
				text: part.thinking,
				status,
				timestamp: message.timestamp,
			};
		}
		if (part.type === "toolCall") {
			if (part.name === REPORT_PROGRESS_TOOL_NAME) {
				const title = stringArgument(part.arguments, "title");
				const detail = stringArgument(part.arguments, "detail");
				if (!title || !detail) return undefined;
				return {
					kind: "progress",
					id: `progress:${part.id}`,
					turnId,
					title,
					detail,
					timestamp: message.timestamp,
				};
			}
			return {
				kind: "tool",
				id: `tool:${part.id}`,
				turnId,
				toolCallId: part.id,
				toolName: part.name,
				status: "running",
				summary: summarizeToolArguments(part.name, part.arguments),
			};
		}
		const text = messageText(message);
		if (!text) return undefined;
		return {
			kind: "message",
			id,
			role: "assistant",
			text,
			status,
			timestamp: message.timestamp,
			stopReason: message.stopReason,
		};
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
