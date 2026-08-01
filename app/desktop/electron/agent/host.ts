import type { AgentEvent, AgentEventListener, AgentMessage } from "@jai/agent";
import {
	type PermissionApprovalDecision,
	PermissionApprovalRegistry,
	type PermissionApprovalRequest,
	type PermissionRequest,
	type PermissionResolution,
} from "@jai/coding/permissions";
import { defineCodedError, toErrorEnvelope } from "@jai/common";
import type {
	DesktopAgentEvent,
	DesktopAgentEventEnvelope,
	DesktopAgentMessageInput,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopMessageItem,
	DesktopPermissionItem,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";

const desktopAgentError = defineCodedError("desktop_agent", [
	"factory_unavailable",
	"session_not_found",
	"session_busy",
] as const);

export interface HostedCodingAgent {
	invoke(input: string): Promise<AgentMessage[]>;
	generateTitle?(firstMessage: string, messages: readonly AgentMessage[]): Promise<string>;
	subscribe(listener: AgentEventListener): () => void;
	abort(): void;
	steer(message: AgentMessage): void;
	followUp(message: AgentMessage): void;
	close(): void;
}

export interface DesktopAgentFactoryContext {
	readonly sessionId: string;
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
	readonly agent: HostedCodingAgent;
	readonly items: Map<string, DesktopTranscriptItem>;
	unsubscribe: () => void;
	status: DesktopAgentStatus;
	closed: boolean;
	seq: number;
	nextMessageId: number;
	activeAssistantId?: string;
	activeUserId?: string;
	pendingDelta?: DesktopAgentEvent;
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
		if (runtime.status === "running") {
			throw desktopAgentError("session_busy", {
				message: `Session "${input.sessionId}" is already running`,
				data: { sessionId: input.sessionId },
			});
		}
		runtime.status = "running";
		this.#emitNow(runtime, { type: "status", status: "running" });
		void runtime.agent.invoke(input.message).then(
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
					).catch(() => {});
				}
			},
			(error) => {
				this.#emitNow(runtime, { type: "runtime_error", error: toErrorEnvelope(error) });
				this.#finishRun(runtime);
			},
		);
		return { accepted: true };
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
		this.#clearPendingDelta(runtime);
		this.#approvals.cancelSession(sessionId);
		runtime.agent.close();
		runtime.unsubscribe();
		this.#sessions.delete(sessionId);
	}

	close(): void {
		for (const sessionId of [...this.#sessions.keys()]) this.closeSession(sessionId);
		this.#approvals.close();
	}

	async #getOrCreate(input: DesktopAgentMessageInput): Promise<SessionRuntime> {
		const existing = this.#sessions.get(input.sessionId);
		if (existing) return existing;
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
		const agent = await this.#factory!({
			sessionId: input.sessionId,
			requestApproval: (request, signal) => this.#requestApproval(input.sessionId, request, signal),
		});
		const runtime: SessionRuntime = {
			sessionId: input.sessionId,
			agent,
			items: new Map(),
			unsubscribe: () => {},
			status: "idle",
			closed: false,
			seq: 0,
			nextMessageId: 1,
		};
		runtime.unsubscribe = agent.subscribe((event) => this.#onAgentEvent(runtime, event));
		this.#sessions.set(input.sessionId, runtime);
		return runtime;
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
				const item = this.#projectMessage(runtime, event.message, "streaming");
				runtime.items.set(item.id, item);
				this.#emitNow(runtime, { type: "transcript_upsert", item });
				return;
			}
			case "message_update": {
				const item = this.#projectMessage(runtime, event.message, "streaming");
				runtime.items.set(item.id, item);
				this.#queueDelta(runtime, { type: "transcript_upsert", item });
				return;
			}
			case "message_end": {
				const item = this.#projectMessage(runtime, event.message, "complete");
				runtime.items.set(item.id, item);
				this.#emitNow(runtime, { type: "transcript_upsert", item });
				this.#onSessionActivity?.(runtime.sessionId);
				if (event.message.role === "assistant") runtime.activeAssistantId = undefined;
				if (event.message.role === "user") runtime.activeUserId = undefined;
				return;
			}
			case "tool_execution_start": {
				const item: DesktopToolItem = {
					kind: "tool",
					id: `tool:${event.toolCallId}`,
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
				const previous = runtime.items.get(`tool:${event.toolCallId}`);
				const item: DesktopToolItem = {
					kind: "tool",
					id: `tool:${event.toolCallId}`,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: event.type === "tool_execution_update" ? "running" : event.isError ? "error" : "complete",
					summary: summarizeToolResult(event.type === "tool_execution_update" ? event.partial : event.result),
					...(previous?.kind === "tool" &&
					previous.summary &&
					!summarizeToolResult(event.type === "tool_execution_update" ? event.partial : event.result)
						? { summary: previous.summary }
						: {}),
				};
				runtime.items.set(item.id, item);
				this.#emitNow(runtime, { type: "transcript_upsert", item });
				return;
			}
			default:
				return;
		}
	}

	#projectMessage(
		runtime: SessionRuntime,
		message: AgentMessage,
		status: DesktopMessageItem["status"],
	): DesktopMessageItem {
		let id: string;
		switch (message.role) {
			case "assistant":
				id = runtime.activeAssistantId ?? `message:${runtime.nextMessageId++}`;
				runtime.activeAssistantId = id;
				break;
			case "user":
				id = runtime.activeUserId ?? `message:${runtime.nextMessageId++}`;
				runtime.activeUserId = id;
				break;
			case "toolResult":
				id = `tool-result:${message.toolCallId}`;
				break;
		}
		return {
			kind: "message",
			id,
			role: message.role,
			text: messageText(message),
			status,
			timestamp: message.timestamp,
			...(message.role === "assistant" ? { stopReason: message.stopReason } : {}),
		};
	}

	#queueDelta(runtime: SessionRuntime, event: DesktopAgentEvent): void {
		runtime.pendingDelta = event;
		if (runtime.flushTimer) return;
		runtime.flushTimer = setTimeout(() => this.#flushPendingDelta(runtime), 16);
		runtime.flushTimer.unref?.();
	}

	#flushPendingDelta(runtime: SessionRuntime): void {
		if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
		runtime.flushTimer = undefined;
		const event = runtime.pendingDelta;
		runtime.pendingDelta = undefined;
		if (event) this.#emitEnvelope(runtime, event);
	}

	#clearPendingDelta(runtime: SessionRuntime): void {
		if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
		runtime.flushTimer = undefined;
		runtime.pendingDelta = undefined;
	}

	#emitNow(runtime: SessionRuntime, event: DesktopAgentEvent): void {
		this.#flushPendingDelta(runtime);
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
		this.#emitNow(runtime, { type: "status", status: "idle" });
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
	const path = stringArgument(args, "path");
	return truncate(command ?? path ?? toolName, 240);
}

function summarizeToolResult(result: { content: readonly unknown[] }): string | undefined {
	const text = result.content
		.filter(
			(part): part is { type: "text"; text: string } =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n");
	return text ? truncate(text, 500) : undefined;
}

function messageText(message: AgentMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.flatMap((part) => {
			if (part.type === "text") return [part.text];
			if (part.type === "thinking") return [part.thinking];
			if (part.type === "toolCall") return [`${part.name}(…)`];
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
