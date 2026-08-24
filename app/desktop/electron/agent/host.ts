import type {
	CodingAgent,
	CodingAgentMessage,
	CodingExtensionApprovalDecision,
	CodingExtensionApprovalRequest,
	CodingPermissionDecision,
	CodingPermissionRequest,
} from "@jai/coding-agent";
import { toErrorEnvelope } from "@jai/common";
import type {
	DesktopAgentEventEnvelope,
	DesktopAgentMessageInput,
	DesktopAgentMode,
	DesktopAgentNavigateInput,
	DesktopAgentSnapshot,
	DesktopAgentStatus,
	DesktopArtifact,
	DesktopExtensionPermissionResolution,
} from "../../shared/desktop-rpc";
import { DesktopAgentApprovalRequests } from "./approval-requests";
import { sortArtifacts } from "./artifacts";
import { desktopAgentError } from "./errors";
import { LiveAgentProjection } from "./projection/runtime-events";
import type { DesktopAgentRuntimeInput, DesktopAgentSendInput, SessionRuntime } from "./runtime";

export type { DesktopAgentSendInput } from "./runtime";

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

export class DesktopAgentHost {
	readonly #sessions = new Map<string, SessionRuntime>();
	readonly #creating = new Map<string, Promise<SessionRuntime>>();
	readonly #approvalRequests: DesktopAgentApprovalRequests<SessionRuntime>;
	readonly #projection: LiveAgentProjection;
	#factory?: DesktopAgentFactory;
	#onSessionActivity?: (sessionId: string) => void;
	#onRunCompleted?: (context: DesktopRunCompletedContext) => void | Promise<void>;

	constructor(emit: DesktopAgentEventSink, factory?: DesktopAgentFactory) {
		this.#factory = factory;
		this.#projection = new LiveAgentProjection({
			emit,
			onSessionActivity: (sessionId) => this.#onSessionActivity?.(sessionId),
		});
		this.#approvalRequests = new DesktopAgentApprovalRequests<SessionRuntime>(
			(sessionId) => this.#requireSession(sessionId),
			(runtime, event) => this.#projection.emitNow(runtime, event),
		);
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
		let runtime = await this.#getOrCreate(input);
		if (runtime.rebinding) {
			await runtime.rebinding;
			runtime = await this.#getOrCreate(input);
		}
		runtime.pendingRuns += 1;
		runtime.status = "running";
		this.#projection.emitNow(runtime, { type: "status", status: "running" });
		const run = runtime.agent.prompt(input.message, {
			...(input.resolvedAttachments?.length ? { attachments: input.resolvedAttachments } : {}),
		});
		void run.then(
			(result) => {
				if (result.isErr()) {
					this.#projection.emitNow(runtime, {
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
				this.#projection.emitNow(runtime, { type: "runtime_error", error: { code: toErrorEnvelope(error).code } });
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
		this.#approvalRequests.cancelSession(sessionId);
	}

	steer(input: DesktopAgentMessageInput): void {
		void this.#requireSession(input.sessionId).agent.steer(input.message);
	}

	followUp(input: DesktopAgentMessageInput): void {
		void this.#requireSession(input.sessionId).agent.followUp(input.message);
	}

	async navigate(input: DesktopAgentNavigateInput): Promise<void> {
		const runtime = await this.#getOrCreate(input);
		if (runtime.status === "running" || runtime.agent.state.status === "running" || runtime.rebinding) {
			throw desktopAgentError("session_busy", {
				message: `Session "${input.sessionId}" is busy`,
				data: { sessionId: input.sessionId },
			});
		}

		const navigation = runtime.agent.navigate(input.entryId).then((result) => {
			if (result.isErr()) {
				throw desktopAgentError("navigation_failed", {
					message: "Unable to restore the selected message.",
					data: { sessionId: input.sessionId, entryId: input.entryId },
				});
			}
			this.closeSession(input.sessionId);
		});
		runtime.rebinding = navigation;
		try {
			await navigation;
		} finally {
			if (runtime.rebinding === navigation) runtime.rebinding = undefined;
		}
	}

	resolvePermission(resolution: { readonly requestId: string; readonly decision: CodingPermissionDecision }): void {
		this.#approvalRequests.resolveTool(resolution);
	}

	resolveExtensionPermission(resolution: DesktopExtensionPermissionResolution): void {
		this.#approvalRequests.resolveExtension(resolution);
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
		this.#projection.clear(runtime);
		this.#approvalRequests.cancelSession(sessionId);
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
		this.#approvalRequests.close();
	}

	async #getOrCreate(input: DesktopAgentRuntimeInput): Promise<SessionRuntime> {
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

	async #createRuntime(input: DesktopAgentRuntimeInput): Promise<SessionRuntime> {
		const agent = await this.#createAgent(input.sessionId, input.modelRef, input.mode);
		const todos = agent.state.todos;
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
		runtime.unsubscribe = agent.subscribe((event) => this.#projection.onAgentEvent(runtime, event));
		for (const artifact of agent.state.artifacts) runtime.artifacts.set(artifact.id, artifact);
		this.#sessions.set(input.sessionId, runtime);
		return runtime;
	}

	#createAgent(sessionId: string, modelRef: string, mode: DesktopAgentMode): Promise<CodingAgent> {
		return this.#factory!({
			sessionId,
			modelRef,
			mode,
			requestApproval: (request, signal) => this.#approvalRequests.requestTool(sessionId, request, signal),
			requestExtensionApproval: (request, signal) =>
				this.#approvalRequests.requestExtension(sessionId, request, signal),
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
		runtime.unsubscribe = replacement.subscribe((event) => this.#projection.onAgentEvent(runtime, event));
		this.#approvalRequests.cancelSession(runtime.sessionId);
		void previous.close();
	}

	#finishRun(runtime: SessionRuntime): void {
		if (runtime.closed) return;
		runtime.pendingRuns = Math.max(0, runtime.pendingRuns - 1);
		if (runtime.pendingRuns > 0) return;
		runtime.status = "idle";
		this.#projection.emitNow(runtime, { type: "status", status: "idle" });
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
