import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AcpJsonRpcNotification,
	AcpJsonRpcRequest,
	LocalAcpV2Client,
} from "@jai/server/acp-client";
import { connectJaiRuntimeHost } from "@jai/server/acp-client";
import { Result, TaggedError } from "better-result";
import type {
	DesktopAgentEvent,
	DesktopAgentEventEnvelope,
	DesktopAgentMessageInput,
	DesktopAgentMode,
	DesktopAgentNavigateInput,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopArtifact,
	DesktopMessageAttachment,
	DesktopMessageItem,
	DesktopPermissionRequest,
	DesktopPermissionResolution,
	DesktopThinkingItem,
	DesktopTodoItem,
	DesktopTodos,
	DesktopToolActivityKind,
	DesktopToolFileChange,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { sortArtifacts } from "./artifacts";
import { desktopAgentError } from "./errors";
import { resolveDesktopRuntimeHostEntrypoint } from "../runtime-host/entrypoint";

class DesktopAcpConnectionFailed extends TaggedError("desktop_agent.acp_connection_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

class DesktopAcpRequestFailed extends TaggedError("desktop_agent.acp_request_failed")<{
	readonly message: string;
	readonly method: string;
	readonly cause?: unknown;
}> {}

class DesktopAcpConnectionClosed extends TaggedError("desktop_agent.acp_connection_closed")<{
	readonly message: string;
}> {}

interface AcpSessionRuntime {
	readonly sessionId: string;
	readonly cwd: string;
	modelRef: string;
	mode: DesktopAgentMode;
	configured: boolean;
	status: DesktopAgentStatus;
	readonly items: Map<string, DesktopTranscriptItem>;
	readonly artifacts: Map<string, DesktopArtifact>;
	readonly terminalToolCallIds: Map<string, string>;
	readonly terminalOutput: Map<string, string>;
	todos?: DesktopTodos;
	seq: number;
	closed: boolean;
}

export interface DesktopAcpAgentHostOptions {
	readonly dataDirectory?: string;
	readonly endpoint?: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly resolveSessionCwd: (sessionId: string) => Promise<string>;
	readonly client?: LocalAcpV2Client;
}

export type DesktopAcpAgentEventSink = (envelope: DesktopAgentEventEnvelope) => void;

export interface DesktopAcpSendInput extends DesktopAgentMessageInput {
	readonly resolvedAttachments?: readonly DesktopAttachmentLike[];
}

/**
 * Desktop's Agent seam. It owns only volatile ACP projections and approval
 * routing; Runtime Host owns the Session journal, Coding Agent and recovery.
 */
export class DesktopAcpAgentHost {
	readonly #emit: DesktopAcpAgentEventSink;
	readonly #resolveSessionCwd: (sessionId: string) => Promise<string>;
	readonly #sessions = new Map<string, AcpSessionRuntime>();
	readonly #pendingPermissions = new Map<string, PendingPermission>();
	readonly #client: LocalAcpV2Client;
	readonly #unsubscribeUpdates: () => void;
	readonly #unsubscribeRequests: () => void;
	#closed = false;

	private constructor(client: LocalAcpV2Client, emit: DesktopAcpAgentEventSink, options: DesktopAcpAgentHostOptions) {
		this.#client = client;
		this.#emit = emit;
		this.#resolveSessionCwd = options.resolveSessionCwd;
		this.#unsubscribeUpdates = client.subscribe((notification) => this.#onNotification(notification));
		this.#unsubscribeRequests = client.subscribeRequest((request) => this.#onRequest(request));
	}

	static async open(
		emit: DesktopAcpAgentEventSink,
		options: DesktopAcpAgentHostOptions,
	): Promise<DesktopAcpAgentHost> {
		const runtimeHostEntrypoint = resolveDesktopRuntimeHostEntrypoint();
		const clientResult = options.client
			? Result.ok(options.client)
			: await connectJaiRuntimeHost({
				...(options.dataDirectory === undefined ? {} : { dataDirectory: options.dataDirectory }),
				...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
				...(options.environment === undefined ? {} : { environment: options.environment }),
				...(runtimeHostEntrypoint === undefined ? {} : { runtimeHostEntrypoint }),
			});
		if (clientResult.isErr()) {
			throw new DesktopAcpConnectionFailed({
				message: "Desktop could not connect to the Jai Runtime Host",
				cause: clientResult.error,
			});
		}
		const initialized = await clientResult.value.request("initialize", {
			protocolVersion: 2,
			capabilities: {},
			info: { name: "jai-desktop", version: "0.0.0" },
		});
		if (initialized.isErr()) {
			await clientResult.value.close();
			throw new DesktopAcpConnectionFailed({
				message: "Desktop could not initialize the Runtime Host ACP connection",
				cause: initialized.error,
			});
		}
		return new DesktopAcpAgentHost(clientResult.value, emit, options);
	}

	async send(input: DesktopAcpSendInput): Promise<{ readonly accepted: true }> {
		const runtime = await this.#ensureSession(input.sessionId, input.modelRef, input.mode);
		await this.#setConfiguration(runtime, input.modelRef, input.mode);
		const prompt = [
			{ type: "text", text: input.message } as const,
			...(input.resolvedAttachments ?? []).map((attachment) => ({
				type: "resource_link" as const,
				uri: pathToFileURL(attachment.sourcePath).toString(),
				name: attachment.filename,
			})),
		];
		const response = await this.#request("session/prompt", { sessionId: runtime.sessionId, prompt });
		if (response.isErr()) throw response.error;
		return { accepted: true };
	}

	async navigate(_input: DesktopAgentNavigateInput): Promise<void> {
		throw desktopAgentError("unsupported_operation", {
			message: "ACP v2 does not expose branch navigation yet.",
			data: { sessionId: _input.sessionId },
		});
	}

	abort(sessionId: string): void {
		const runtime = this.#requireSession(sessionId);
		this.#cancelPendingPermissions(runtime);
		const sent = this.#client.notify("session/cancel", { sessionId });
		if (sent.isErr()) this.#emitRuntimeError(runtime, sent.error.message);
	}

	steer(input: DesktopAgentMessageInput): void {
		void this.send(input).catch((error) => {
			const runtime = this.#sessions.get(input.sessionId);
			if (runtime) this.#emitRuntimeError(runtime, error instanceof Error ? error.message : "Could not send steering input");
		});
	}

	followUp(input: DesktopAgentMessageInput): void {
		throw desktopAgentError("unsupported_operation", {
			message: "Follow-up is unavailable until its input admission is durable.",
			data: { sessionId: input.sessionId },
		});
	}

	resolvePermission(resolution: DesktopPermissionResolution): void {
		if ("kind" in resolution) return;
		const pending = this.#pendingPermissions.get(resolution.requestId);
		if (!pending) return;
		this.#pendingPermissions.delete(resolution.requestId);
		const optionId = resolution.decision === "alwaysAllow" ? "allow-always" : resolution.decision === "allowOnce" ? "allow-once" : "reject";
		const sent = this.#client.respond({
			jsonrpc: "2.0",
			id: pending.requestId,
			result: { outcome: { outcome: "selected", optionId } },
		});
		if (sent.isErr()) pending.reject(sent.error);
		else pending.resolve();
		this.#emitEvent(pending.runtime, {
			type: "transcript_upsert",
			item: { ...pending.item, status: resolution.decision === "deny" ? "denied" : "allowed" },
		});
	}

	resolveExtensionPermission(_resolution: unknown): void {
		// Extension approvals are not part of the current Runtime Host ACP surface.
	}

	async rebindSession<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		this.closeSession(sessionId);
		return operation();
	}

	hasSession(sessionId: string): boolean {
		return this.#sessions.has(sessionId);
	}

	runningSessionIds(): string[] {
		return [...this.#sessions.values()].filter((session) => session.status === "running").map((session) => session.sessionId);
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

	/** Rebuilds a disposable projection from the Host's durable Session facts. */
	async ensureSessionProjection(sessionId: string): Promise<DesktopAgentSnapshot> {
		await this.#ensureSession(sessionId, "", "manual");
		return this.getSnapshot(sessionId);
	}

	getArtifact(sessionId: string, artifactId: string): DesktopArtifact | undefined {
		const artifact = this.#sessions.get(sessionId)?.artifacts.get(artifactId);
		return artifact ? structuredClone(artifact) : undefined;
	}

	closeSession(sessionId: string): void {
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) return;
		this.#cancelPendingPermissions(runtime);
		runtime.closed = true;
		this.#sessions.delete(sessionId);
		void this.#client.request("session/close", { sessionId });
	}

	invalidateSessions(): void {
		for (const sessionId of [...this.#sessions.keys()]) this.closeSession(sessionId);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const sessionId of [...this.#sessions.keys()]) this.closeSession(sessionId);
		this.#unsubscribeUpdates();
		this.#unsubscribeRequests();
		for (const pending of this.#pendingPermissions.values()) pending.reject(new DesktopAcpConnectionClosed({ message: "ACP connection closed" }));
		this.#pendingPermissions.clear();
		void this.#client.close();
	}

	async #ensureSession(sessionId: string, modelRef: string, mode: DesktopAgentMode): Promise<AcpSessionRuntime> {
		const current = this.#sessions.get(sessionId);
		if (current) return current;
		const cwd = await this.#resolveSessionCwd(sessionId);
		const runtime: AcpSessionRuntime = {
			sessionId,
			cwd,
			modelRef,
			mode,
			configured: false,
			status: "idle",
			items: new Map(),
			artifacts: new Map(),
			terminalToolCallIds: new Map(),
			terminalOutput: new Map(),
			seq: 0,
			closed: false,
		};
		this.#sessions.set(sessionId, runtime);
		const resumed = await this.#client.request("session/resume", { sessionId, cwd, replayFrom: { type: "start" } });
		if (resumed.isErr()) {
			const created = await this.#client.request("session/new", { sessionId, cwd });
			if (created.isErr()) {
				this.#sessions.delete(sessionId);
				throw new DesktopAcpRequestFailed({ method: "session/new", message: created.error.message, cause: created.error });
			}
		}
		return runtime;
	}

	async #setConfiguration(runtime: AcpSessionRuntime, modelRef: string, mode: DesktopAgentMode): Promise<void> {
		const options: readonly [string, string][] = [
			["model", modelRef],
			["mode", mode],
		];
		for (const [configId, value] of options) {
			if (runtime.configured && configId === "model" && runtime.modelRef === value) continue;
			if (runtime.configured && configId === "mode" && runtime.mode === value) continue;
			const updated = await this.#request("session/set_config_option", {
				sessionId: runtime.sessionId,
				configId,
				type: "id",
				value,
			});
			if (updated.isErr()) throw updated.error;
			if (configId === "model") runtime.modelRef = value;
			else runtime.mode = value as DesktopAgentMode;
		}
		runtime.configured = true;
	}

	async #request(method: string, params: unknown) {
		const result = await this.#client.request(method, params);
		if (result.isErr()) {
			return Result.err(
				new DesktopAcpRequestFailed({ method, message: result.error.message, cause: result.error }),
			);
		}
		return Result.ok(result.value);
	}

	#onNotification(notification: AcpJsonRpcNotification): void {
		if (notification.method !== "session/update" || !isRecord(notification.params)) return;
		const sessionId = notification.params.sessionId;
		const update = notification.params.update;
		if (typeof sessionId !== "string" || !isRecord(update) || typeof update.sessionUpdate !== "string") return;
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) return;
		switch (update.sessionUpdate) {
			case "state_update":
				this.#stateUpdate(runtime, update);
				return;
			case "user_message":
				this.#messageUpdate(runtime, update, "user");
				return;
			case "agent_message":
			case "agent_message_chunk":
				this.#messageUpdate(runtime, update, "assistant");
				return;
			case "agent_thought":
			case "agent_thought_chunk":
				this.#thoughtUpdate(runtime, update);
				return;
			case "tool_call_update":
				this.#toolUpdate(runtime, update);
				return;
			case "tool_call_content_chunk":
				this.#toolContentChunk(runtime, update);
				return;
			case "terminal_update":
				this.#terminalUpdate(runtime, update);
				return;
			case "terminal_output_chunk":
				this.#terminalOutputChunk(runtime, update);
				return;
			case "plan_update":
				this.#planUpdate(runtime, update);
				return;
		}
	}

	#onRequest(request: AcpJsonRpcRequest): void {
		if (request.method !== "session/request_permission" || request.id === undefined || !isRecord(request.params)) return;
		const sessionId = request.params.sessionId;
		const runtime = typeof sessionId === "string" ? this.#sessions.get(sessionId) : undefined;
		if (!runtime) {
			this.#client.respond({ jsonrpc: "2.0", id: request.id, result: { outcome: { outcome: "cancelled" } } });
			return;
		}
		const projected = projectPermission(runtime, request);
		const item = { kind: "permission" as const, id: `permission:${projected.request.requestId}`, request: projected.request, status: "pending" as const };
		runtime.items.set(item.id, item);
		this.#pendingPermissions.set(projected.request.requestId, {
			requestId: request.id,
			runtime,
			item,
			resolve: () => undefined,
			reject: () => undefined,
		});
		this.#emitEvent(runtime, { type: "transcript_upsert", item });
	}

	#stateUpdate(runtime: AcpSessionRuntime, update: Record<string, unknown>): void {
		const state = update.state;
		runtime.status = state === "running" || state === "requires_action" ? "running" : "idle";
		this.#emitEvent(runtime, { type: "status", status: runtime.status });
		if (update.stopReason === "error") this.#emitRuntimeError(runtime, "Runtime Host operation failed");
	}

	#messageUpdate(runtime: AcpSessionRuntime, update: Record<string, unknown>, role: "user" | "assistant"): void {
		if (typeof update.messageId !== "string") return;
		const id = `message:${update.messageId}`;
		if (update.content === null) {
			runtime.items.delete(id);
			this.#emitEvent(runtime, { type: "transcript_remove", id });
			return;
		}
		const text = contentText(update.content);
		const previous = runtime.items.get(id);
		const previousText = previous?.kind === "message" ? previous.text : "";
		const complete = update.sessionUpdate === "user_message" || update.sessionUpdate === "agent_message";
		const slashInvocation = role === "user" ? parseSlashInvocation(update.slashInvocation) : undefined;
		const item: DesktopMessageItem = {
			kind: "message",
			id,
			role,
			text: update.content === null ? "" : complete ? text : previousText + text,
			status: complete ? "complete" : "streaming",
			timestamp: Date.now(),
			...(slashInvocation ? { slashInvocation } : {}),
		};
		runtime.items.set(id, item);
		this.#emitEvent(runtime, { type: "transcript_upsert", item });
	}

	#thoughtUpdate(runtime: AcpSessionRuntime, update: Record<string, unknown>): void {
		if (typeof update.messageId !== "string") return;
		const id = `thinking:${update.messageId}`;
		if (update.content === null) {
			runtime.items.delete(id);
			this.#emitEvent(runtime, { type: "transcript_remove", id });
			return;
		}
		const previous = runtime.items.get(id);
		const text = contentText(update.content);
		const item: DesktopThinkingItem = {
			kind: "thinking",
			id,
			turnId: update.messageId,
			activityId: update.messageId,
			text: update.content === null ? "" : update.sessionUpdate === "agent_thought" ? text : previous?.kind === "thinking" ? previous.text + text : text,
			status: update.sessionUpdate === "agent_thought" ? "complete" : "streaming",
			timestamp: Date.now(),
		};
		runtime.items.set(id, item);
		this.#emitEvent(runtime, { type: "transcript_upsert", item });
	}

	#toolUpdate(runtime: AcpSessionRuntime, update: Record<string, unknown>): void {
		if (typeof update.toolCallId !== "string") return;
		const id = `tool:${update.toolCallId}`;
		const previous = runtime.items.get(id);
		const previousTool = previous?.kind === "tool" ? previous : undefined;
		const status = update.status === "completed" || update.status === "failed" ? "complete" : "running";
		const title = typeof update.title === "string" ? update.title : previousTool?.toolName ?? "Tool";
		let bufferedTerminalOutput = "";
		for (const terminalId of terminalIds(update.content)) {
			runtime.terminalToolCallIds.set(terminalId, update.toolCallId);
			bufferedTerminalOutput += runtime.terminalOutput.get(terminalId) ?? "";
		}
		const durableDetails = toolContentText(update.content);
		const fileChanges = toolFileChanges(update.content);
		const details = durableDetails || previousTool?.details || bufferedTerminalOutput;
		const item: DesktopToolItem = {
			kind: "tool",
			id,
			turnId: previousTool?.turnId ?? id,
			activityId: previousTool?.activityId ?? id,
			toolCallId: update.toolCallId,
			toolName: title,
			activityKind: activityKind(title),
			status,
			...(previousTool?.summary ? { summary: previousTool.summary } : {}),
			...(details ? { details } : {}),
			...(fileChanges.length > 0
				? { fileChanges }
				: previousTool?.fileChanges
					? { fileChanges: previousTool.fileChanges }
					: {}),
		};
		runtime.items.set(id, item);
		this.#emitEvent(runtime, { type: "transcript_upsert", item });
	}

	#terminalUpdate(runtime: AcpSessionRuntime, update: Record<string, unknown>): void {
		if (typeof update.terminalId !== "string" || !isRecord(update.output) || typeof update.output.data !== "string")
			return;
		const text = terminalText(update.output.data);
		runtime.terminalOutput.set(update.terminalId, text);
		const toolCallId = runtime.terminalToolCallIds.get(update.terminalId);
		if (!toolCallId) return;
		const current = runtime.items.get(`tool:${toolCallId}`);
		if (current?.kind !== "tool") return;
		const item: DesktopToolItem = { ...current, details: text };
		runtime.items.set(item.id, item);
		this.#emitEvent(runtime, { type: "transcript_upsert", item });
	}

	#terminalOutputChunk(runtime: AcpSessionRuntime, update: Record<string, unknown>): void {
		if (typeof update.terminalId !== "string" || typeof update.data !== "string") return;
		const text = terminalText(update.data);
		if (!text) return;
		const output = `${runtime.terminalOutput.get(update.terminalId) ?? ""}${text}`;
		runtime.terminalOutput.set(update.terminalId, output);
		const toolCallId = runtime.terminalToolCallIds.get(update.terminalId);
		if (!toolCallId) return;
		const current = runtime.items.get(`tool:${toolCallId}`);
		if (current?.kind !== "tool") return;
		const item: DesktopToolItem = { ...current, details: `${current.details ?? ""}${text}` };
		runtime.items.set(item.id, item);
		this.#emitEvent(runtime, { type: "transcript_upsert", item });
	}

	#toolContentChunk(runtime: AcpSessionRuntime, update: Record<string, unknown>): void {
		if (typeof update.toolCallId !== "string") return;
		const current = runtime.items.get(`tool:${update.toolCallId}`);
		if (current?.kind !== "tool") return;
		const details = contentText(isRecord(update.content) ? update.content.content : update.content);
		if (!details) return;
		const item: DesktopToolItem = { ...current, details: `${current.details ?? ""}${details}` };
		runtime.items.set(item.id, item);
		this.#emitEvent(runtime, { type: "transcript_upsert", item });
	}

	#planUpdate(runtime: AcpSessionRuntime, update: Record<string, unknown>): void {
		const plan = update.plan;
		if (!isRecord(plan) || plan.planId !== "todos" || !Array.isArray(plan.entries)) return;
		const todos: DesktopTodoItem[] = plan.entries.flatMap((entry, index): DesktopTodoItem[] => {
			if (!isRecord(entry) || typeof entry.content !== "string") return [];
			if (
				entry.status !== "pending" &&
				entry.status !== "in_progress" &&
				entry.status !== "completed" &&
				entry.status !== "cancelled"
			)
				return [];
			const status = entry.status;
			return [{ id: `acp-plan:${index}`, content: entry.content, status }];
		});
		runtime.todos = todos;
		this.#emitEvent(runtime, { type: "todos_replace", todos });
	}

	/**
	 * ACP requests that the Client complete every pending permission interaction
	 * with its explicit cancelled outcome before it stops presenting the Session.
	 * The Host maps that back to the SDK's fail-closed decision; this method only
	 * settles the disposable Client interaction and never writes a second fact.
	 */
	#cancelPendingPermissions(runtime: AcpSessionRuntime): void {
		for (const [requestId, pending] of this.#pendingPermissions) {
			if (pending.runtime !== runtime) continue;
			this.#pendingPermissions.delete(requestId);
			const sent = this.#client.respond({
				jsonrpc: "2.0",
				id: pending.requestId,
				result: { outcome: { outcome: "cancelled" } },
			});
			if (sent.isErr()) pending.reject(sent.error);
			else pending.resolve();
			this.#emitEvent(runtime, { type: "transcript_upsert", item: { ...pending.item, status: "cancelled" } });
		}
	}

	#emitRuntimeError(runtime: AcpSessionRuntime, code: string): void {
		this.#emitEvent(runtime, { type: "runtime_error", error: { code } });
	}

	#emitEvent(runtime: AcpSessionRuntime, event: DesktopAgentEvent): void {
		if (runtime.closed) return;
		runtime.seq += 1;
		this.#emit({ sessionId: runtime.sessionId, seq: runtime.seq, event: structuredClone(event) });
	}

	#requireSession(sessionId: string): AcpSessionRuntime {
		const runtime = this.#sessions.get(sessionId);
		if (!runtime) {
			throw desktopAgentError("session_not_found", { message: `Session "${sessionId}" is not active`, data: { sessionId } });
		}
		return runtime;
	}
}

function parseSlashInvocation(value: unknown): DesktopMessageItem["slashInvocation"] | undefined {
	if (!isRecord(value) || typeof value.name !== "string" || typeof value.displayName !== "string") return undefined;
	if (!value.name.trim() || !value.displayName.trim()) return undefined;
	if (value.kind === "skill") return { name: value.name, kind: "skill", displayName: value.displayName };
	if (value.kind !== "command") return undefined;
	if (value.commandKind !== "extension" && value.commandKind !== "file" && value.commandKind !== "skill") {
		return undefined;
	}
	return {
		name: value.name,
		kind: "command",
		commandKind: value.commandKind,
		displayName: value.displayName,
	};
}

interface DesktopAttachmentLike extends DesktopMessageAttachment {
	readonly sourcePath: string;
}

interface PendingPermission {
	readonly requestId: string | number;
	readonly runtime: AcpSessionRuntime;
	readonly item: Extract<DesktopTranscriptItem, { readonly kind: "permission" }>;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
}

function projectPermission(runtime: AcpSessionRuntime, request: AcpJsonRpcRequest): { readonly request: DesktopPermissionRequest } {
	const params = request.params as Record<string, unknown>;
	const subject = isRecord(params.subject) && isRecord(params.subject.toolCall) ? params.subject.toolCall : {};
	const toolCallId = typeof subject.toolCallId === "string" ? subject.toolCallId : `permission-${String(request.id)}`;
	const title = typeof params.title === "string" ? params.title : "Permission required";
	const options = Array.isArray(params.options) ? params.options : [];
	return {
		request: {
			requestId: toolCallId,
			sessionId: runtime.sessionId,
			toolCallId,
			toolName: typeof subject.title === "string" ? subject.title : "Tool",
			reason: title,
			canAlwaysAllow: options.some((option) => isRecord(option) && option.optionId === "allow-always"),
			summary: { title, ...(typeof params.description === "string" ? { description: params.description } : {}) },
		},
	};
}

function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("");
}

function terminalIds(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) =>
		isRecord(item) && item.type === "terminal" && typeof item.terminalId === "string" ? [item.terminalId] : [],
	);
}

function toolContentText(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.flatMap((item) => (isRecord(item) && item.type === "content" ? [item.content] : []))
		.map((content) => contentText([content]))
		.join("");
}

function toolFileChanges(value: unknown): readonly DesktopToolFileChange[] {
	if (!Array.isArray(value)) return [];
	const fileChanges: DesktopToolFileChange[] = [];
	for (const item of value) {
		if (!isRecord(item) || item.type !== "diff" || !Array.isArray(item.changes)) continue;
		for (const change of item.changes) {
			if (!isRecord(change) || typeof change.path !== "string" || !isAbsolute(change.path)) continue;
			if (change.operation !== "add" && change.operation !== "modify" && change.operation !== "delete") continue;
			fileChanges.push({ operation: change.operation, path: change.path });
		}
	}
	return fileChanges;
}

function terminalText(data: string): string {
	try {
		return Buffer.from(data, "base64").toString("utf8");
	} catch {
		return "";
	}
}

function activityKind(toolName: string): DesktopToolActivityKind {
	const normalized = toolName.toLowerCase();
	if (normalized.includes("search") || normalized.includes("grep") || normalized.includes("glob")) return "search";
	if (normalized.includes("read")) return "read";
	if (normalized.includes("write") || normalized.includes("edit")) return "write";
	if (normalized.includes("bash") || normalized.includes("shell") || normalized.includes("execute")) return "execute";
	if (normalized.includes("call") || normalized.includes("connector")) return "call";
	return "operation";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
