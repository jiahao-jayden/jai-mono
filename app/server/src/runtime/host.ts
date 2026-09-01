import {
	branchOf,
	type JsonObject,
	type JsonValue,
	type MessageEntry,
	type OperationAccepted,
	type OperationFinished,
	type OperationRecoveryVerdict,
	recoverSessionOperations,
	type SessionEntry,
} from "@jai/agent";
import type { AssistantMessage } from "@jai/ai";
import { Result, TaggedError } from "better-result";
import {
	createOperationEffectBoundary,
	type RuntimeApprovalDecision,
	type RuntimeApprovalHandler,
	type RuntimeApprovalRequest,
	type RuntimeOperation,
	type RuntimeOperationDriver,
	type RuntimeOperationEvent,
	RuntimeOperationExecutionFailed,
	type RuntimeOperationOutcome,
	type RuntimeQueuedInput,
} from "../operations";
import type {
	ProductSessionDurableState,
	ProductSessionInfo,
	ProductSessionPersistence,
	RuntimeSessionConfiguration,
	RuntimeSessionConfigurationChange,
	RuntimeSessionConfigurationPolicy,
	RuntimeSessionConfigurationSnapshot,
} from "../sessions";
import {
	createUnconfiguredRuntimeSessionConfigurationPolicy,
	isRuntimeSessionMode,
	type RuntimeSessionConfigurationInvalid,
	RuntimeSessionStore,
} from "../sessions";

export type RuntimeSessionSelection<TAppState extends JsonObject = JsonObject> =
	| {
			readonly kind: "new";
			readonly id?: string;
			readonly appState?: TAppState;
			readonly cwd?: string;
			readonly controllerId?: string;
			/**
			 * Host-owned, connection-scoped Session facts. They use the same
			 * execution protocol as a durable Session, but never enter the
			 * Product Session Persistence or its Catalog projection.
			 */
			readonly ephemeral?: boolean;
	  }
	| {
			readonly kind: "resume";
			readonly id: string;
			readonly cwd?: string;
			readonly controllerId?: string;
	  };

export interface PromptAdmission {
	readonly operationId: string;
	readonly inputEntryId: string;
}

export interface RuntimePromptInput {
	readonly text: string;
	readonly delivery?: "steer" | "follow_up";
	readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface RuntimeCancelOutcome {
	readonly cancelled: boolean;
	readonly operationId?: string;
}

export type RuntimeForegroundState = "running" | "requires_action" | "idle";
export type RuntimeStopReason = "end_turn" | "cancelled" | "error";

/** A volatile, one-way projection emitted only after its durable cause is committed. */
export type RuntimeSessionEvent =
	| {
			readonly type: "entry_appended";
			readonly entry: SessionEntry<JsonObject>;
	  }
	| {
			/** A durable usage ledger update, projected as a cumulative client-facing cost. */
			readonly type: "usage_changed";
			readonly cost: number;
	  }
	| {
			/** Ephemeral display progress. Replay always derives from durable Session entries instead. */
			readonly type: "operation_event";
			readonly operationId: string;
			readonly event: RuntimeOperationEvent;
	  }
	| {
			readonly type: "state_changed";
			readonly state: RuntimeForegroundState;
			readonly operationId?: string;
			readonly stopReason?: RuntimeStopReason;
	  }
	| {
			readonly type: "configuration_changed";
			readonly configuration: RuntimeSessionConfigurationSnapshot;
	  }
	| {
			readonly type: "approval_requested";
			readonly request: RuntimeApprovalRequest;
	  };

export interface RuntimeSessionSnapshot {
	readonly entries: readonly SessionEntry<JsonObject>[];
	readonly leafId: string | null;
	readonly recovery: readonly OperationRecoveryVerdict[];
	/** Cumulative durable model cost, including discarded responses. */
	readonly usage: { readonly cost: number };
	readonly state: RuntimeForegroundState;
	readonly stopReason?: RuntimeStopReason;
}

export class RuntimeHostSessionNotFound extends TaggedError("runtime_host.session_not_found")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class RuntimeHostSessionAlreadyExists extends TaggedError("runtime_host.session_already_exists")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class RuntimeHostPromptRejected extends TaggedError("runtime_host.prompt_rejected")<{
	readonly sessionId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeHostRecoveryCorrupted extends TaggedError("runtime_host.recovery_corrupted")<{
	readonly sessionId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeHostIndeterminateTool extends TaggedError("runtime_host.indeterminate_tool")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
}> {}

export class RuntimeHostSessionControllerHeld extends TaggedError("runtime_host.session_controller_held")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class RuntimeHostEphemeralSessionsUnavailable extends TaggedError(
	"runtime_host.ephemeral_sessions_unavailable",
)<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class RuntimeHostSessionBusy extends TaggedError("runtime_host.session_busy")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
}> {}

export class RuntimeHostApprovalNotFound extends TaggedError("runtime_host.approval_not_found")<{
	readonly sessionId: string;
	readonly requestId: string;
	readonly message: string;
}> {}

export class RuntimeHostConfigurationRejected extends TaggedError("runtime_host.configuration_rejected")<{
	readonly sessionId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

class RuntimeHostApprovalCancelled extends TaggedError("runtime_host.approval_cancelled")<{
	readonly sessionId: string;
	readonly requestId: string;
	readonly message: string;
}> {}

export type RuntimeHostOpenError =
	| RuntimeHostSessionNotFound
	| RuntimeHostSessionAlreadyExists
	| RuntimeHostPromptRejected
	| RuntimeHostRecoveryCorrupted
	| RuntimeHostSessionControllerHeld
	| RuntimeHostEphemeralSessionsUnavailable
	| RuntimeHostConfigurationRejected;

export type RuntimeHostRecoveryError = RuntimeHostPromptRejected | RuntimeHostRecoveryCorrupted;
export type RuntimeHostCancelError =
	| RuntimeHostPromptRejected
	| RuntimeHostRecoveryCorrupted
	| RuntimeHostIndeterminateTool;
export type RuntimeHostPromptError = RuntimeHostPromptRejected | RuntimeHostSessionBusy | RuntimeHostIndeterminateTool;
export type RuntimeHostSnapshotError = RuntimeHostPromptRejected | RuntimeHostRecoveryCorrupted;
export type RuntimeHostApprovalError = RuntimeHostPromptRejected | RuntimeHostApprovalNotFound;
export type RuntimeHostConfigurationError = RuntimeHostPromptRejected | RuntimeHostConfigurationRejected;

export interface RuntimeSession {
	readonly id: string;
	readonly info: ProductSessionInfo;
	prompt(input: RuntimePromptInput): Promise<Result<PromptAdmission, RuntimeHostPromptError>>;
	navigate(entryId: string): Promise<Result<void, RuntimeHostPromptError>>;
	recovery(): Promise<Result<readonly OperationRecoveryVerdict[], RuntimeHostRecoveryError>>;
	snapshot(): Promise<Result<RuntimeSessionSnapshot, RuntimeHostSnapshotError>>;
	configuration(): Promise<Result<RuntimeSessionConfigurationSnapshot, RuntimeHostConfigurationError>>;
	setConfiguration(
		input: RuntimeSessionConfigurationChange,
	): Promise<Result<RuntimeSessionConfigurationSnapshot, RuntimeHostConfigurationError>>;
	subscribe(listener: (event: RuntimeSessionEvent) => void): () => void;
	respondToApproval(input: {
		readonly requestId: string;
		readonly decision: RuntimeApprovalDecision;
	}): Promise<Result<void, RuntimeHostApprovalError>>;
	cancel(): Promise<Result<RuntimeCancelOutcome, RuntimeHostCancelError>>;
	close(): Promise<void>;
}

export interface RuntimeHost {
	listSessions(): Promise<Result<readonly ProductSessionInfo[], RuntimeHostPromptRejected>>;
	openSession(input: RuntimeSessionSelection): Promise<Result<RuntimeSession, RuntimeHostOpenError>>;
	/** Attaches a disposable observer without taking a Session controller or opening a driver. */
	observeSession(
		sessionId: string,
		listener: (event: RuntimeSessionEvent) => void,
	): Promise<Result<() => void, RuntimeHostPromptRejected>>;
}

export interface RuntimeHostOptions {
	readonly persistence: ProductSessionPersistence;
	/**
	 * Product composition supplies the one non-durable adapter used for a
	 * connection-scoped Session. RuntimeHost keeps its lifetime and never
	 * exposes it to an ACP client.
	 */
	readonly createEphemeralPersistence?: () => ProductSessionPersistence;
	/** Optional product driver; tests can exercise durable admission without a live model runtime. */
	readonly operationDriver?: RuntimeOperationDriver;
	/** Product assembly chooses the SDK's initial Session App State format. */
	readonly initialAppState?: () => JsonObject;
	readonly configurationPolicy?: RuntimeSessionConfigurationPolicy;
	readonly createId?: () => string;
	readonly now?: () => Date;
}

export function createRuntimeHost(options: RuntimeHostOptions): RuntimeHost {
	return new DefaultRuntimeHost(options);
}

class DefaultRuntimeHost implements RuntimeHost {
	readonly #createId: () => string;
	readonly #now: () => Date;
	readonly #initialAppState: () => JsonObject;
	readonly #configurationPolicy: RuntimeSessionConfigurationPolicy;
	readonly #controllers = new Map<string, string>();
	/**
	 * Durable Sessions that still belong to this Host process. A reconnect must
	 * reattach to this runtime instead of reducing the same Journal into a
	 * second Operation driver.
	 */
	readonly #liveSessions = new Map<string, DefaultRuntimeSession>();
	readonly #ephemeralPersistences = new Map<string, ProductSessionPersistence>();
	readonly #pendingSessionIds = new Set<string>();

	constructor(private readonly options: RuntimeHostOptions) {
		this.#createId = options.createId ?? (() => crypto.randomUUID());
		this.#now = options.now ?? (() => new Date());
		this.#initialAppState = options.initialAppState ?? (() => ({}));
		this.#configurationPolicy = options.configurationPolicy ?? createUnconfiguredRuntimeSessionConfigurationPolicy();
	}

	async listSessions(): Promise<Result<readonly ProductSessionInfo[], RuntimeHostPromptRejected>> {
		const result = await this.options.persistence.list();
		if (result.isOk()) return Result.ok(result.value);
		return Result.err(
			new RuntimeHostPromptRejected({
				message: "Could not list Runtime Host Sessions",
				sessionId: result.error.sessionId,
				cause: result.error,
			}),
		);
	}

	async openSession(input: RuntimeSessionSelection): Promise<Result<RuntimeSession, RuntimeHostOpenError>> {
		if (input.kind === "resume") {
			const found = await this.options.persistence.load(input.id);
			if (found.isErr()) return Result.err(this.projectOpenError(found.error));
			if (input.cwd !== undefined && input.cwd !== found.value.cwd) {
				return Result.err(
					new RuntimeHostPromptRejected({
						message: `Session "${input.id}" belongs to a different workspace`,
						sessionId: input.id,
					}),
				);
			}
			const held = this.acquireController(input.id, input.controllerId);
			if (held) return Result.err(held);
			const live = this.#liveSessions.get(input.id);
			if (live) {
				live.attachController(() => this.releaseController(input.id, input.controllerId));
				return Result.ok(live);
			}
			const recovery = recoverDurableState(found.value);
			if (recovery.isErr()) {
				this.releaseController(input.id, input.controllerId);
				return Result.err(recovery.error);
			}
			const finalized = await this.finalizeInferredTerminals(found.value, recovery.value);
			if (finalized.isErr()) {
				this.releaseController(input.id, input.controllerId);
				return finalized;
			}
			const session = this.runtimeSession(finalized.value.state, input.controllerId);
			const resumed = session.resume(finalized.value.verdicts);
			if (resumed.isErr()) {
				await session.close();
				return Result.err(resumed.error);
			}
			return Result.ok(session);
		}

		const id = input.id ?? this.#createId();
		if (this.#pendingSessionIds.has(id) || this.#ephemeralPersistences.has(id)) {
			return Result.err(
				new RuntimeHostSessionAlreadyExists({
					message: `Session "${id}" already exists`,
					sessionId: id,
				}),
			);
		}
		this.#pendingSessionIds.add(id);
		try {
			return await this.openNewSession(input, id);
		} finally {
			this.#pendingSessionIds.delete(id);
		}
	}

	async observeSession(
		sessionId: string,
		listener: (event: RuntimeSessionEvent) => void,
	): Promise<Result<() => void, RuntimeHostPromptRejected>> {
		const live = this.#liveSessions.get(sessionId);
		if (live) return Result.ok(live.subscribe(listener));
		const found = await this.options.persistence.load(sessionId);
		if (found.isErr()) {
			return Result.err(
				new RuntimeHostPromptRejected({
					message: found.error.message,
					sessionId: found.error.sessionId,
					cause: found.error,
				}),
			);
		}
		return Result.ok(() => {});
	}

	private async openNewSession(
		input: Extract<RuntimeSessionSelection, { readonly kind: "new" }>,
		id: string,
	): Promise<Result<RuntimeSession, RuntimeHostOpenError>> {
		const initialConfiguration = await this.#configurationPolicy.initialConfiguration();
		if (initialConfiguration.isErr()) {
			return Result.err(
				new RuntimeHostConfigurationRejected({
					message: initialConfiguration.error.message,
					sessionId: id,
					cause: initialConfiguration.error,
				}),
			);
		}
		const ephemeralPersistence = input.ephemeral ? this.options.createEphemeralPersistence?.() : undefined;
		if (input.ephemeral && !ephemeralPersistence) {
			return Result.err(
				new RuntimeHostEphemeralSessionsUnavailable({
					message: "Runtime Host does not have an ephemeral Session adapter",
					sessionId: id,
				}),
			);
		}
		if (ephemeralPersistence) {
			const durable = await this.options.persistence.load(id);
			if (durable.isOk()) {
				return Result.err(
					new RuntimeHostSessionAlreadyExists({
						message: `Session "${id}" already exists`,
						sessionId: id,
					}),
				);
			}
			if (durable.error._tag !== "product_sessions.not_found")
				return Result.err(this.projectOpenError(durable.error));
		}
		const persistence = ephemeralPersistence ?? this.options.persistence;
		const now = this.#now();
		const created = await persistence.create({
			id,
			appState: input.appState ?? this.#initialAppState(),
			runtimeConfiguration: initialConfiguration.value,
			cwd: input.cwd ?? process.cwd(),
			createdAt: now.toISOString(),
		});
		if (created.isErr()) return Result.err(this.projectOpenError(created.error));
		const durable = await persistence.load(id);
		if (durable.isErr()) return Result.err(this.projectOpenError(durable.error));
		const held = this.acquireController(id, input.controllerId);
		if (held) return Result.err(held);
		if (!ephemeralPersistence) return Result.ok(this.runtimeSession(durable.value, input.controllerId));

		this.#ephemeralPersistences.set(id, ephemeralPersistence);
		return Result.ok(
			this.runtimeSession(
				durable.value,
				input.controllerId,
				ephemeralPersistence,
				() => {
					this.releaseController(id, input.controllerId);
					if (this.#ephemeralPersistences.get(id) === ephemeralPersistence) {
						this.#ephemeralPersistences.delete(id);
					}
				},
				true,
			),
		);
	}

	projectOpenError(error: {
		readonly _tag: string;
		readonly message: string;
		readonly sessionId: string;
	}): RuntimeHostOpenError {
		switch (error._tag) {
			case "product_sessions.not_found":
				return new RuntimeHostSessionNotFound({
					message: error.message,
					sessionId: error.sessionId,
				});
			case "product_sessions.already_exists":
				return new RuntimeHostSessionAlreadyExists({
					message: error.message,
					sessionId: error.sessionId,
				});
			default:
				return new RuntimeHostPromptRejected({
					message: error.message,
					sessionId: error.sessionId,
					cause: error,
				});
		}
	}

	/**
	 * A final assistant entry is sufficient to stop execution, but the Host still
	 * records the derived outcome so future recovery reads one explicit terminal
	 * fact. This repair runs before a recovered driver can be opened.
	 */
	private async finalizeInferredTerminals(
		state: ProductSessionDurableState,
		verdicts: readonly OperationRecoveryVerdict[],
	): Promise<
		Result<
			{
				readonly state: ProductSessionDurableState;
				readonly verdicts: readonly OperationRecoveryVerdict[];
			},
			RuntimeHostOpenError
		>
	> {
		const inferred = verdicts.filter(
			(verdict): verdict is Extract<OperationRecoveryVerdict, { readonly status: "terminal" }> =>
				verdict.status === "terminal" && verdict.finalization === "inferred",
		);
		if (inferred.length === 0) return Result.ok({ state, verdicts });

		for (const verdict of inferred) {
			const appended = await this.options.persistence.appendOperation({
				sessionId: state.id,
				record: {
					type: "operation_finished",
					operationId: verdict.operationId,
					outcome: verdict.outcome,
					timestamp: this.#now().toISOString(),
				},
			});
			if (appended.isErr()) return Result.err(this.projectOpenError(appended.error));
		}

		const reloaded = await this.options.persistence.load(state.id);
		if (reloaded.isErr()) return Result.err(this.projectOpenError(reloaded.error));
		const recovered = recoverDurableState(reloaded.value);
		if (recovered.isErr()) return Result.err(recovered.error);
		return Result.ok({ state: reloaded.value, verdicts: recovered.value });
	}

	private runtimeSession(
		state: ProductSessionDurableState,
		controllerId: string | undefined,
		persistence: ProductSessionPersistence = this.options.persistence,
		releaseController: () => void = () => this.releaseController(state.id, controllerId),
		discardWhenClosed = false,
	): DefaultRuntimeSession {
		let session: DefaultRuntimeSession;
		session = new DefaultRuntimeSession(
			state,
			persistence,
			this.options.operationDriver,
			this.#configurationPolicy,
			this.#createId,
			this.#now,
			releaseController,
			discardWhenClosed,
			() => {
				if (this.#liveSessions.get(state.id) === session) this.#liveSessions.delete(state.id);
			},
		);
		if (!discardWhenClosed) this.#liveSessions.set(state.id, session);
		return session;
	}

	private acquireController(
		sessionId: string,
		controllerId: string | undefined,
	): RuntimeHostSessionControllerHeld | undefined {
		if (controllerId === undefined) return undefined;
		const heldBy = this.#controllers.get(sessionId);
		if (heldBy !== undefined && heldBy !== controllerId) {
			return new RuntimeHostSessionControllerHeld({
				message: `Session "${sessionId}" is controlled by another ACP connection`,
				sessionId,
			});
		}
		this.#controllers.set(sessionId, controllerId);
		return undefined;
	}

	private releaseController(sessionId: string, controllerId: string | undefined): void {
		if (controllerId !== undefined && this.#controllers.get(sessionId) === controllerId) {
			this.#controllers.delete(sessionId);
		}
	}
}

class DefaultRuntimeSession implements RuntimeSession {
	readonly id: string;
	readonly info: ProductSessionInfo;
	#tail = Promise.resolve();
	#closed = false;
	#active?: ActiveOperation;
	#indeterminate?: RuntimeHostIndeterminateTool;
	/**
	 * A live driver ended after an input had been durably accepted but before its
	 * Session Journal entry existed. The durable reducer can safely recover this
	 * state after reopening; this process must not admit another input or invent a
	 * terminal outcome in the meantime.
	 */
	#suspended?: RuntimeOperationExecutionFailed;
	#usageCost: number;
	readonly #pendingApprovals = new Map<string, PendingRuntimeApproval>();
	readonly #listeners = new Set<(event: RuntimeSessionEvent) => void>();

	constructor(
		state: ProductSessionDurableState,
		private readonly persistence: ProductSessionPersistence,
		private readonly operationDriver: RuntimeOperationDriver | undefined,
		private readonly configurationPolicy: RuntimeSessionConfigurationPolicy,
		private readonly createId: () => string,
		private readonly now: () => Date,
		private releaseController: () => void,
		private readonly discardWhenClosed: boolean,
		private readonly releaseLiveSession: () => void,
	) {
		this.id = state.id;
		this.info = state;
		this.#usageCost = usageCost(state.operationRecords);
	}

	/** Host-only reconnect seam. No journal recovery is allowed while this driver is live. */
	attachController(releaseController: () => void): void {
		if (!this.#closed) return;
		this.#closed = false;
		this.releaseController = releaseController;
	}

	async prompt(input: RuntimePromptInput): Promise<Result<PromptAdmission, RuntimeHostPromptError>> {
		if (this.#closed) return Result.err(this.closed());
		if (!input.text.trim()) {
			return Result.err(
				new RuntimeHostPromptRejected({
					message: "Prompt must not be empty",
					sessionId: this.id,
				}),
			);
		}
		const admitted = await this.enqueue(async () => {
			if (this.#suspended) {
				return Result.err(
					new RuntimeHostSessionBusy({
						message: `Operation "${this.#suspended.operationId}" must be recovered before this Session can accept another input`,
						sessionId: this.id,
						operationId: this.#suspended.operationId,
					}),
				);
			}
			if (this.#indeterminate) return Result.err(this.#indeterminate);
			if (this.operationDriver && this.#active) return this.queueActiveInput(this.#active, input);
			const operationId = this.createId();
			const loaded = await this.persistence.load(this.id);
			if (loaded.isErr()) return Result.err(this.reject(loaded.error));
			if (this.operationDriver?.preflight) {
				const prepared = await this.operationDriver.preflight({
					sessionId: this.id,
					cwd: this.info.cwd,
					operationId,
					runtimeConfiguration: loaded.value.runtimeConfiguration,
				});
				if (prepared.isErr()) return Result.err(this.reject(prepared.error));
			}
			const inputEntryId = `${operationId}:input`;

			const timestamp = this.now();
			const inputEntry: MessageEntry = {
				type: "message",
				id: inputEntryId,
				parentId: loaded.value.snapshot.leafId,
				timestamp: timestamp.toISOString(),
				message: {
					role: "user",
					content: input.text,
					timestamp: timestamp.getTime(),
					...(input.metadata ? { metadata: input.metadata } : {}),
				},
			};
			const operation: OperationAccepted = {
				type: "operation_accepted",
				operationId,
				kind: "prompt",
				inputEntryId,
				startLeafId: loaded.value.snapshot.leafId,
				timestamp: timestamp.toISOString(),
			};
			const accepted = await this.persistence.admitPrompt({
				sessionId: this.id,
				inputEntry,
				operation,
			});
			if (accepted.isErr()) return Result.err(this.reject(accepted.error));
			if (this.operationDriver) this.#active = createActiveOperation(operationId);
			this.publish({ type: "entry_appended", entry: inputEntry });
			return Result.ok({ operationId, inputEntryId });
		});
		if (admitted.isOk() && !this.#suspended) {
			this.publish({
				type: "state_changed",
				state: "running",
				operationId: admitted.value.operationId,
			});
			if (this.operationDriver) this.startOperation(admitted.value.operationId);
		}
		return admitted;
	}

	/** Starts exactly one recovered provider-safe operation; indeterminate tools are deliberately parked. */
	resume(verdicts: readonly OperationRecoveryVerdict[]): Result<void, RuntimeHostRecoveryCorrupted> {
		if (!this.operationDriver) return Result.ok(undefined);
		const active = verdicts.filter((verdict) => verdict.status !== "terminal");
		if (active.length === 0) return Result.ok(undefined);
		if (active.length > 1) {
			return Result.err(
				new RuntimeHostRecoveryCorrupted({
					message: `Session "${this.id}" has more than one non-terminal Operation`,
					sessionId: this.id,
				}),
			);
		}
		const verdict = active[0]!;
		if (verdict.status === "indeterminate_tool") {
			this.#indeterminate = new RuntimeHostIndeterminateTool({
				message: `Operation "${verdict.operationId}" requires tool reconciliation before it can resume`,
				sessionId: this.id,
				operationId: verdict.operationId,
			});
			return Result.ok(undefined);
		}
		this.#active = createActiveOperation(verdict.operationId, queuedInputsFor(verdict));
		this.startOperation(verdict.operationId);
		return Result.ok(undefined);
	}

	async recovery(): Promise<Result<readonly OperationRecoveryVerdict[], RuntimeHostRecoveryError>> {
		if (this.#closed) return Result.err(this.closed());
		const loaded = await this.persistence.load(this.id);
		if (loaded.isErr()) return Result.err(this.reject(loaded.error));
		return recoverDurableState(loaded.value);
	}

	async snapshot(): Promise<Result<RuntimeSessionSnapshot, RuntimeHostSnapshotError>> {
		if (this.#closed) return Result.err(this.closed());
		const loaded = await this.persistence.load(this.id);
		if (loaded.isErr()) return Result.err(this.reject(loaded.error));
		const recovery = recoverDurableState(loaded.value);
		if (recovery.isErr()) return recovery;
		const foreground = this.foregroundState(loaded.value, recovery.value);
		return Result.ok({
			entries: loaded.value.snapshot.entries,
			leafId: loaded.value.snapshot.leafId,
			recovery: recovery.value,
			usage: { cost: usageCost(loaded.value.operationRecords) },
			...foreground,
		});
	}

	async navigate(entryId: string): Promise<Result<void, RuntimeHostPromptError>> {
		if (this.#closed) return Result.err(this.closed());
		if (!entryId.trim()) {
			return Result.err(
				new RuntimeHostPromptRejected({
					message: "Navigation target must not be empty",
					sessionId: this.id,
				}),
			);
		}
		return this.enqueue(async () => {
			if (this.#suspended) {
				return Result.err(
					new RuntimeHostSessionBusy({
						message: `Operation "${this.#suspended.operationId}" must be recovered before this Session can navigate`,
						sessionId: this.id,
						operationId: this.#suspended.operationId,
					}),
				);
			}
			if (this.#indeterminate) return Result.err(this.#indeterminate);
			if (this.#active) {
				return Result.err(
					new RuntimeHostSessionBusy({
						message: `Session "${this.id}" cannot navigate while Operation "${this.#active.operationId}" is active`,
						sessionId: this.id,
						operationId: this.#active.operationId,
					}),
				);
			}
			const loaded = await this.persistence.load(this.id);
			if (loaded.isErr()) return Result.err(this.reject(loaded.error));
			const recovered = recoverDurableState(loaded.value);
			if (recovered.isErr()) return Result.err(this.reject(recovered.error));
			const active = recovered.value.find((verdict) => verdict.status !== "terminal");
			if (active) {
				return Result.err(
					new RuntimeHostSessionBusy({
						message: `Session "${this.id}" cannot navigate while Operation "${active.operationId}" is active`,
						sessionId: this.id,
						operationId: active.operationId,
					}),
				);
			}
			const snapshot = loaded.value.snapshot;
			if (!snapshot.entries.some((entry) => entry.id === entryId)) {
				return Result.err(
					new RuntimeHostPromptRejected({
						message: `Session "${this.id}" has no entry "${entryId}"`,
						sessionId: this.id,
					}),
				);
			}
			const fromId = snapshot.leafId;
			if (fromId === null) return Result.ok(undefined);
			let abandoned: readonly SessionEntry<JsonObject>[];
			try {
				const kept = new Set(branchOf(snapshot.entries, entryId).map((entry) => entry.id));
				abandoned = branchOf(snapshot.entries, fromId).filter((entry) => !kept.has(entry.id));
			} catch (error) {
				return Result.err(
					new RuntimeHostPromptRejected({
						message: `Session "${this.id}" has a broken branch while navigating to "${entryId}"`,
						sessionId: this.id,
						cause: error,
					}),
				);
			}
			if (abandoned.length === 0) return Result.ok(undefined);
			const entry = {
				type: "branch" as const,
				id: this.createId(),
				parentId: entryId,
				fromId,
				timestamp: this.now().toISOString(),
			};
			const appended = await this.persistence.appendEntry({
				sessionId: this.id,
				entry,
				expectedRevision: loaded.value.revision,
			});
			if (appended.isErr()) return Result.err(this.reject(appended.error));
			this.publish({ type: "entry_appended", entry });
			return Result.ok(undefined);
		});
	}

	async configuration(): Promise<Result<RuntimeSessionConfigurationSnapshot, RuntimeHostConfigurationError>> {
		if (this.#closed) return Result.err(this.closed());
		const loaded = await this.persistence.load(this.id);
		if (loaded.isErr()) return Result.err(this.reject(loaded.error));
		return this.projectConfiguration(loaded.value.runtimeConfiguration);
	}

	async setConfiguration(
		input: RuntimeSessionConfigurationChange,
	): Promise<Result<RuntimeSessionConfigurationSnapshot, RuntimeHostConfigurationError>> {
		if (this.#closed) return Result.err(this.closed());
		return this.enqueue(async () => {
			const loaded = await this.persistence.load(this.id);
			if (loaded.isErr()) return Result.err(this.reject(loaded.error));
			const next = await this.applyConfigurationChange(loaded.value.runtimeConfiguration, input);
			if (next.isErr()) return Result.err(next.error);
			const appended = await this.persistence.appendRuntimeConfiguration({
				sessionId: this.id,
				configuration: next.value,
				timestamp: this.now().toISOString(),
			});
			if (appended.isErr()) return Result.err(this.reject(appended.error));
			const projected = await this.projectConfiguration(next.value);
			if (projected.isErr()) return projected;
			this.publish({
				type: "configuration_changed",
				configuration: projected.value,
			});
			return projected;
		});
	}

	subscribe(listener: (event: RuntimeSessionEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async respondToApproval(input: {
		readonly requestId: string;
		readonly decision: RuntimeApprovalDecision;
	}): Promise<Result<void, RuntimeHostApprovalError>> {
		if (this.#closed) return Result.err(this.closed());
		return this.enqueue(async () => {
			const pending = this.#takeApproval(input.requestId);
			if (!pending) {
				return Result.err(
					new RuntimeHostApprovalNotFound({
						message: `Approval request "${input.requestId}" is not pending for Session "${this.id}"`,
						sessionId: this.id,
						requestId: input.requestId,
					}),
				);
			}
			if (input.decision === "alwaysAllow" && !pending.request.canAlwaysAllow) {
				pending.reject(
					new RuntimeHostApprovalCancelled({
						message: `Approval request "${input.requestId}" cannot be remembered`,
						sessionId: this.id,
						requestId: input.requestId,
					}),
				);
				return Result.err(
					new RuntimeHostPromptRejected({
						message: `Approval request "${input.requestId}" does not allow an always-allow decision`,
						sessionId: this.id,
					}),
				);
			}
			pending.resolve(input.decision);
			if (this.#pendingApprovals.size === 0 && this.#active) {
				this.publish({
					type: "state_changed",
					state: "running",
					operationId: this.#active.operationId,
				});
			}
			return Result.ok(undefined);
		});
	}

	async cancel(): Promise<Result<RuntimeCancelOutcome, RuntimeHostCancelError>> {
		if (this.#closed) return Result.err(this.closed());
		if (this.#suspended) {
			return Result.err(
				new RuntimeHostPromptRejected({
					message: `Operation "${this.#suspended.operationId}" must be recovered before it can be cancelled`,
					sessionId: this.id,
					cause: this.#suspended,
				}),
			);
		}
		if (this.#indeterminate) return Result.err(this.#indeterminate);
		if (this.operationDriver && this.#active) return this.cancelLiveOperation(this.#active);
		const cancelled = await this.enqueue(async () => {
			const loaded = await this.persistence.load(this.id);
			if (loaded.isErr()) return Result.err(this.reject(loaded.error));
			const recovered = recoverDurableState(loaded.value);
			if (recovered.isErr()) return recovered;
			const active = recovered.value.find((verdict) => verdict.status !== "terminal");
			if (!active) return Result.ok({ cancelled: false });
			if (active.status === "indeterminate_tool") {
				return Result.err(
					new RuntimeHostIndeterminateTool({
						message: `Operation "${active.operationId}" requires tool reconciliation before it can be cancelled`,
						sessionId: this.id,
						operationId: active.operationId,
					}),
				);
			}
			const terminal: OperationFinished = {
				type: "operation_finished",
				operationId: active.operationId,
				outcome: "aborted",
				timestamp: this.now().toISOString(),
			};
			const appended = await this.persistence.appendOperation({
				sessionId: this.id,
				record: terminal,
			});
			if (appended.isErr()) return Result.err(this.reject(appended.error));
			this.publish({
				type: "state_changed",
				state: "idle",
				operationId: active.operationId,
				stopReason: "cancelled",
			});
			return Result.ok({ cancelled: true, operationId: active.operationId });
		});
		return cancelled;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		if (this.discardWhenClosed && this.#active) {
			this.#active.abortRequested = true;
			if (this.#active.resource) void this.#active.resource.abort().catch(() => {});
		}
		this.cancelPendingApprovals("Runtime Session was closed");
		this.releaseController();
		this.releaseLiveSessionIfDetached();
	}

	private startOperation(operationId: string): void {
		const active = this.#active;
		if (!active || active.operationId !== operationId || !this.operationDriver || active.completion) return;
		active.completion = this.runOperation(active);
	}

	private async applyConfigurationChange(
		current: RuntimeSessionConfiguration,
		input: RuntimeSessionConfigurationChange,
	): Promise<Result<RuntimeSessionConfiguration, RuntimeHostConfigurationRejected>> {
		if (input.configId === "mode") {
			if (!isRuntimeSessionMode(input.value)) {
				return Result.err(
					new RuntimeHostConfigurationRejected({
						message: `Unsupported Session mode "${input.value}"`,
						sessionId: this.id,
					}),
				);
			}
			return Result.ok({ ...current, mode: input.value });
		}

		const models = await this.configurationPolicy.listModels();
		if (models.isErr()) return Result.err(this.rejectConfiguration(models.error));
		if (!models.value.some((model) => model.value === input.value)) {
			return Result.err(
				new RuntimeHostConfigurationRejected({
					message: `Model "${input.value}" is not available for this Runtime Host`,
					sessionId: this.id,
				}),
			);
		}
		const valid = await this.configurationPolicy.validateModel(input.value);
		if (valid.isErr()) return Result.err(this.rejectConfiguration(valid.error));
		return Result.ok({ ...current, model: input.value });
	}

	private async projectConfiguration(
		configuration: RuntimeSessionConfiguration,
	): Promise<Result<RuntimeSessionConfigurationSnapshot, RuntimeHostConfigurationRejected>> {
		const models = await this.configurationPolicy.listModels();
		if (models.isErr()) return Result.err(this.rejectConfiguration(models.error));
		return Result.ok({ configuration, models: models.value });
	}

	private rejectConfiguration(error: RuntimeSessionConfigurationInvalid): RuntimeHostConfigurationRejected {
		return new RuntimeHostConfigurationRejected({
			message: error.message,
			sessionId: this.id,
			cause: error,
		});
	}

	/** Records a mid-run input before offering it to the disposable live Agent. */
	private async queueActiveInput(
		active: ActiveOperation,
		input: RuntimePromptInput,
	): Promise<Result<PromptAdmission, RuntimeHostPromptError>> {
		if (active.resource && !active.resource.enqueueInput) {
			return Result.err(
				new RuntimeHostPromptRejected({
					message: `Operation "${active.operationId}" cannot accept a durable mid-run input`,
					sessionId: this.id,
				}),
			);
		}
		const inputId = this.createId();
		const inputEntryId = this.createId();
		const queued: RuntimeQueuedInput = {
			inputId,
			delivery: input.delivery === "follow_up" ? "follow_up" : "steer",
			entryId: inputEntryId,
			text: input.text,
		};
		const appended = await this.persistence.appendOperation({
			sessionId: this.id,
			record: {
				type: "input_queued",
				operationId: active.operationId,
				inputId,
				delivery: queued.delivery,
				inputEntryId,
				text: input.text,
				timestamp: this.now().toISOString(),
			},
		});
		if (appended.isErr()) return Result.err(this.reject(appended.error));
		active.pendingInputs.push(queued);
		if (active.resource?.enqueueInput) {
			const delivered = await active.resource.enqueueInput(queued);
			if (delivered.isErr()) {
				// `input_queued` is already durable admission. Returning a rejection here
				// would lie to the caller and tempt it to submit the same intent again.
				// Park this process instead; reopening reconstructs the pending T1 input.
				this.suspend(active, delivered.error);
			}
		}
		return Result.ok({ operationId: active.operationId, inputEntryId });
	}

	private async runOperation(
		active: ActiveOperation,
	): Promise<Result<RuntimeOperationOutcome, RuntimeOperationExecutionFailed | RuntimeHostIndeterminateTool>> {
		const driver = this.operationDriver;
		if (!driver) {
			return Result.err(
				new RuntimeOperationExecutionFailed({
					message: `Session "${this.id}" has no configured Operation driver`,
					sessionId: this.id,
					operationId: active.operationId,
				}),
			);
		}

		const loaded = await this.persistence.load(this.id);
		if (loaded.isErr()) {
			return this.completeOperation(
				active,
				Result.err(
					new RuntimeOperationExecutionFailed({
						message: `Could not load durable Runtime configuration for Operation "${active.operationId}"`,
						sessionId: this.id,
						operationId: active.operationId,
						cause: loaded.error,
					}),
				),
			);
		}
		const configuration = loaded.value.operationRuntimeConfigurations.find(
			(candidate) => candidate.operationId === active.operationId,
		)?.configuration;
		if (!configuration) {
			return this.completeOperation(
				active,
				Result.err(
					new RuntimeOperationExecutionFailed({
						message: `Operation "${active.operationId}" has no durable Runtime configuration snapshot`,
						sessionId: this.id,
						operationId: active.operationId,
					}),
				),
			);
		}

		const opened = await driver.openOperation({
			sessionId: this.id,
			cwd: this.info.cwd,
			operationId: active.operationId,
			runtimeConfiguration: configuration,
			sessionStore: new RuntimeSessionStore(this.persistence, (_sessionId, entry) =>
				this.publish({ type: "entry_appended", entry }),
			),
			effectBoundary: createOperationEffectBoundary({
				sessionId: this.id,
				operationId: active.operationId,
				persistence: this.persistence,
				createId: this.createId,
				now: this.now,
			}),
			pendingInputs: active.pendingInputs,
			requestApproval: (request, signal) => this.requestApproval(request, signal),
		});
		if (opened.isErr()) {
			return this.completeOperation(
				active,
				Result.err(
					new RuntimeOperationExecutionFailed({
						message: `Could not start Operation "${active.operationId}"`,
						sessionId: this.id,
						operationId: active.operationId,
						cause: opened.error,
					}),
				),
			);
		}

		active.resource = opened.value;
		active.stopObserving = opened.value.subscribe?.((event) => {
			if (event.type === "usage_settled") {
				const previousCost = this.#usageCost;
				this.#usageCost += finiteCost(event.cost);
				if (this.#usageCost !== previousCost) this.publish({ type: "usage_changed", cost: this.#usageCost });
				return;
			}
			this.publish({
				type: "operation_event",
				operationId: active.operationId,
				event,
			});
		});
		try {
			if (active.abortRequested) {
				const aborted = await active.resource.abort();
				if (aborted.isErr()) return this.completeOperation(active, Result.err(aborted.error));
			}
			return await this.completeOperation(active, await active.resource.awaitOutcome());
		} catch (error) {
			return this.completeOperation(
				active,
				Result.err(
					new RuntimeOperationExecutionFailed({
						message: `Operation "${active.operationId}" stopped unexpectedly`,
						sessionId: this.id,
						operationId: active.operationId,
						cause: error,
					}),
				),
			);
		} finally {
			active.stopObserving?.();
			active.stopObserving = undefined;
			await active.resource.close().catch(() => {});
		}
	}

	private async completeOperation(
		active: ActiveOperation,
		outcome: Result<RuntimeOperationOutcome, RuntimeOperationExecutionFailed>,
	): Promise<Result<RuntimeOperationOutcome, RuntimeOperationExecutionFailed | RuntimeHostIndeterminateTool>> {
		return this.enqueue(async () => {
			const loaded = await this.persistence.load(this.id);
			if (loaded.isErr()) {
				return Result.err(
					new RuntimeOperationExecutionFailed({
						message: `Could not read durable state while completing Operation "${active.operationId}"`,
						sessionId: this.id,
						operationId: active.operationId,
						cause: loaded.error,
					}),
				);
			}
			const recovered = recoverDurableState(loaded.value);
			if (recovered.isErr()) {
				return Result.err(
					new RuntimeOperationExecutionFailed({
						message: `Could not reduce durable state while completing Operation "${active.operationId}"`,
						sessionId: this.id,
						operationId: active.operationId,
						cause: recovered.error,
					}),
				);
			}
			const verdict = recovered.value.find((candidate) => candidate.operationId === active.operationId);
			if (verdict?.status === "indeterminate_tool") {
				const indeterminate = new RuntimeHostIndeterminateTool({
					message: `Operation "${active.operationId}" has a dispatched tool without a durable result`,
					sessionId: this.id,
					operationId: active.operationId,
				});
				this.#indeterminate = indeterminate;
				if (this.#active === active) this.#active = undefined;
				this.releaseLiveSessionIfDetached();
				return Result.err(indeterminate);
			}
			if (hasPendingInputs(verdict)) {
				const failed = new RuntimeOperationExecutionFailed({
					message: `Operation "${active.operationId}" ended before all durable inputs reached the Session Journal`,
					sessionId: this.id,
					operationId: active.operationId,
				});
				this.suspend(active, failed);
				return Result.err(failed);
			}
			if (verdict?.status === "terminal" && verdict.finalization === "durable") {
				if (this.#active === active) this.#active = undefined;
				this.releaseLiveSessionIfDetached();
				return outcome;
			}
			const inferredTerminalOutcome =
				verdict?.status === "terminal" && verdict.finalization === "inferred" && verdict.outcome !== "blocked"
					? verdict.outcome
					: undefined;
			const terminalOutcome = inferredTerminalOutcome ?? (outcome.isOk() ? outcome.value : "failed");

			const terminal: OperationFinished = {
				type: "operation_finished",
				operationId: active.operationId,
				outcome: terminalOutcome,
				timestamp: this.now().toISOString(),
			};
			const appended = await this.persistence.appendOperation({
				sessionId: this.id,
				record: terminal,
			});
			if (appended.isErr()) {
				return Result.err(
					new RuntimeOperationExecutionFailed({
						message: `Could not durably finish Operation "${active.operationId}"`,
						sessionId: this.id,
						operationId: active.operationId,
						cause: appended.error,
					}),
				);
			}
			if (this.#active === active) this.#active = undefined;
			this.releaseLiveSessionIfDetached();
			this.publish({
				type: "state_changed",
				state: "idle",
				operationId: active.operationId,
				stopReason: stopReasonFor(terminalOutcome),
			});
			return inferredTerminalOutcome ? Result.ok(inferredTerminalOutcome) : outcome;
		});
	}

	private async cancelLiveOperation(
		active: ActiveOperation,
	): Promise<Result<RuntimeCancelOutcome, RuntimeHostCancelError>> {
		active.abortRequested = true;
		if (active.resource) {
			const aborted = await active.resource.abort();
			if (aborted.isErr()) return Result.err(this.reject(aborted.error));
		}
		const terminal = active.completion;
		if (!terminal) {
			return Result.err(
				new RuntimeHostPromptRejected({
					message: `Operation "${active.operationId}" has no completion handle`,
					sessionId: this.id,
				}),
			);
		}
		const outcome = await terminal;
		if (outcome.isErr()) {
			if (outcome.error instanceof RuntimeHostIndeterminateTool) return Result.err(outcome.error);
			return Result.err(this.reject(outcome.error));
		}
		return Result.ok({
			cancelled: outcome.value === "aborted",
			...(outcome.value === "aborted" ? { operationId: active.operationId } : {}),
		});
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.#tail.then(operation);
		this.#tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	private foregroundState(
		state: ProductSessionDurableState,
		recovery: readonly OperationRecoveryVerdict[],
	): Pick<RuntimeSessionSnapshot, "state" | "stopReason"> {
		if (this.#suspended) return { state: "requires_action" };
		if (this.#indeterminate || recovery.some((verdict) => verdict.status === "indeterminate_tool")) {
			return { state: "requires_action" };
		}
		if (this.#pendingApprovals.size > 0) return { state: "requires_action" };
		if (this.#active || recovery.some((verdict) => verdict.status !== "terminal")) {
			return { state: "running" };
		}
		const terminal = [...state.operationRecords].reverse().find((record) => record.type === "operation_finished");
		return terminal ? { state: "idle", stopReason: stopReasonFor(terminal.outcome) } : { state: "idle" };
	}

	private publish(event: RuntimeSessionEvent): void {
		for (const listener of [...this.#listeners]) {
			try {
				listener(event);
			} catch {
				// Clients observe projections; a broken client cannot invalidate server execution.
			}
		}
	}

	private reject(error: { readonly message: string; readonly sessionId: string }): RuntimeHostPromptRejected {
		return new RuntimeHostPromptRejected({
			message: error.message,
			sessionId: error.sessionId,
			cause: error,
		});
	}

	private suspend(active: ActiveOperation, error: RuntimeOperationExecutionFailed): void {
		this.#suspended ??= error;
		this.publish({
			type: "state_changed",
			state: "requires_action",
			operationId: active.operationId,
		});
	}

	/**
	 * A detached durable Session keeps its driver only while that driver can
	 * still progress. Terminal, indeterminate and suspended states are rebuilt
	 * from the Journal on the next open instead of retaining a stale runtime.
	 */
	private releaseLiveSessionIfDetached(): void {
		if (!this.#closed) return;
		if (!this.discardWhenClosed && this.#active && !this.#suspended && !this.#indeterminate) return;
		this.releaseLiveSession();
	}

	private closed(): RuntimeHostPromptRejected {
		return new RuntimeHostPromptRejected({
			message: `Runtime Session "${this.id}" is closed`,
			sessionId: this.id,
		});
	}

	private requestApproval: RuntimeApprovalHandler = (request, signal) => {
		if (this.#closed) return Promise.reject(this.approvalCancelled(request.requestId, "Runtime Session was closed"));
		if (request.sessionId !== this.id) {
			return Promise.reject(this.approvalCancelled(request.requestId, "Approval belongs to another Session"));
		}
		if (this.#pendingApprovals.has(request.requestId)) {
			return Promise.reject(this.approvalCancelled(request.requestId, "Approval request is already pending"));
		}
		return new Promise<RuntimeApprovalDecision>((resolve, reject) => {
			const onAbort = signal
				? () => {
						const pending = this.#takeApproval(request.requestId);
						pending?.reject(this.approvalCancelled(request.requestId, "Approval request was cancelled"));
					}
				: undefined;
			if (signal?.aborted) {
				onAbort?.();
				return;
			}
			this.#pendingApprovals.set(request.requestId, {
				request,
				resolve,
				reject,
				signal,
				onAbort,
			});
			signal?.addEventListener("abort", onAbort!, { once: true });
			this.publish({ type: "approval_requested", request });
			this.publish({
				type: "state_changed",
				state: "requires_action",
				operationId: request.operationId,
			});
		});
	};

	#takeApproval(requestId: string): PendingRuntimeApproval | undefined {
		const pending = this.#pendingApprovals.get(requestId);
		if (!pending) return undefined;
		this.#pendingApprovals.delete(requestId);
		if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
		return pending;
	}

	private cancelPendingApprovals(message: string): void {
		for (const requestId of [...this.#pendingApprovals.keys()]) {
			this.#takeApproval(requestId)?.reject(this.approvalCancelled(requestId, message));
		}
	}

	private approvalCancelled(requestId: string, message: string): RuntimeHostApprovalCancelled {
		return new RuntimeHostApprovalCancelled({
			message,
			sessionId: this.id,
			requestId,
		});
	}
}

interface ActiveOperation {
	readonly operationId: string;
	readonly pendingInputs: RuntimeQueuedInput[];
	abortRequested: boolean;
	resource?: RuntimeOperation;
	stopObserving?: () => void;
	completion?: Promise<
		Result<RuntimeOperationOutcome, RuntimeOperationExecutionFailed | RuntimeHostIndeterminateTool>
	>;
}

interface PendingRuntimeApproval {
	readonly request: RuntimeApprovalRequest;
	readonly resolve: (decision: RuntimeApprovalDecision) => void;
	readonly reject: (error: RuntimeHostApprovalCancelled) => void;
	readonly signal?: AbortSignal;
	readonly onAbort?: () => void;
}

function createActiveOperation(
	operationId: string,
	pendingInputs: readonly RuntimeQueuedInput[] = [],
): ActiveOperation {
	return {
		operationId,
		pendingInputs: [...pendingInputs],
		abortRequested: false,
	};
}

function stopReasonFor(outcome: RuntimeOperationOutcome | "blocked"): RuntimeStopReason {
	switch (outcome) {
		case "completed":
			return "end_turn";
		case "aborted":
			return "cancelled";
		case "failed":
		case "blocked":
			return "error";
	}
}

function usageCost(records: readonly import("@jai/agent").OperationRecord[]): number {
	return records.reduce(
		(total, record) => (record.type === "usage_settled" ? total + finiteCost(record.usage.cost.total) : total),
		0,
	);
}

function finiteCost(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

function queuedInputsFor(verdict: OperationRecoveryVerdict): readonly RuntimeQueuedInput[] {
	if (verdict.status !== "ready" && verdict.status !== "provider_interrupted") return [];
	return (verdict.pendingInputs ?? []).map((input) => ({
		inputId: input.inputId,
		delivery: input.delivery,
		entryId: input.inputEntryId,
		text: input.text,
	}));
}

function hasPendingInputs(verdict: OperationRecoveryVerdict | undefined): boolean {
	return (
		(verdict?.status === "ready" || verdict?.status === "provider_interrupted") &&
		(verdict.pendingInputs?.length ?? 0) > 0
	);
}

function recoverDurableState(
	state: ProductSessionDurableState,
): Result<readonly OperationRecoveryVerdict[], RuntimeHostRecoveryCorrupted> {
	const recovered = recoverSessionOperations(state.operationRecords, {
		sessionEntryIds: new Set(state.snapshot.entries.map((entry) => entry.id)),
		terminalOutcomeByAssistantEntryId: terminalOutcomeByAssistantEntryId(state),
	});
	if (recovered.isOk()) return Result.ok(recovered.value);
	return Result.err(
		new RuntimeHostRecoveryCorrupted({
			message: `Session "${state.id}" has a corrupted Operation Journal`,
			sessionId: state.id,
			cause: recovered.error,
		}),
	);
}

function terminalOutcomeByAssistantEntryId(
	state: ProductSessionDurableState,
): ReadonlyMap<string, OperationFinished["outcome"]> {
	const attemptedAssistantEntryIds = new Set(
		state.operationRecords.flatMap((record) => (record.type === "model_attempted" ? [record.assistantEntryId] : [])),
	);
	const outcomes = new Map<string, OperationFinished["outcome"]>();
	for (const entry of state.snapshot.entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		if (!attemptedAssistantEntryIds.has(entry.id)) continue;
		const outcome = terminalOutcomeForAssistant(entry.message);
		if (outcome) outcomes.set(entry.id, outcome);
	}
	return outcomes;
}

function terminalOutcomeForAssistant(message: AssistantMessage): OperationFinished["outcome"] | undefined {
	if (message.content.some((content) => content.type === "toolCall")) return undefined;
	switch (message.stopReason) {
		case "aborted":
			return "aborted";
		case "error":
		case "contextOverflow":
			return "failed";
		case "stop":
		case "length":
		case "iterationLimit":
			return "completed";
		case "toolUse":
			return undefined;
	}
}
