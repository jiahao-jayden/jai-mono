import type { Usage } from "@jai/ai";
import type { Result } from "better-result";
import { TaggedError } from "better-result";
import type { JsonObject } from "../../core/agent-state";

export type DurableOperationKind = "prompt" | "compaction" | "navigation";
export type OperationTerminalOutcome = "completed" | "failed" | "aborted" | "blocked";
export type OperationInputDelivery = "steer" | "follow_up";

interface OperationRecordBase {
	readonly operationId: string;
	readonly timestamp: string;
}

/** Durable admission: the referenced input entry must exist in the Session Journal. */
export interface OperationAccepted extends OperationRecordBase {
	readonly type: "operation_accepted";
	readonly kind: DurableOperationKind;
	readonly inputEntryId: string;
	readonly startLeafId: string | null;
}

/** Intent written before a provider request starts. */
export interface ModelAttempted extends OperationRecordBase {
	readonly type: "model_attempted";
	readonly attemptId: string;
	/** Preallocated Session Journal entry for the final assistant response. */
	readonly assistantEntryId: string;
	readonly modelSnapshotId: string;
}

/** Usage is a ledger fact even when the corresponding response is discarded. */
export interface UsageSettled extends OperationRecordBase {
	readonly type: "usage_settled";
	readonly attemptId: string;
	readonly usage: Usage;
}

/** T1: final arguments are durable before the tool implementation sees them. */
export interface ToolDispatched extends OperationRecordBase {
	readonly type: "tool_dispatched";
	readonly toolCallId: string;
	readonly toolName: string;
	/** The durable assistant message that introduced the tool call. */
	readonly assistantEntryId: string;
	readonly args: JsonObject;
	readonly argsHash: string;
	/** Preallocated Session Journal entry for the T2 tool result. */
	readonly resultEntryId: string;
}

/** Durable input intent. Its Session entry is written only when the Agent reaches a safe checkpoint. */
export interface InputQueued extends OperationRecordBase {
	readonly type: "input_queued";
	readonly inputId: string;
	readonly delivery: OperationInputDelivery;
	/** Preallocated Session Journal entry for the user message once it is consumed. */
	readonly inputEntryId: string;
	readonly text: string;
}

export interface OperationFinished extends OperationRecordBase {
	readonly type: "operation_finished";
	readonly outcome: OperationTerminalOutcome;
}

/**
 * Operation records express execution facts only. Messages and tool results remain
 * Session Journal entries, so the same transcript is never stored twice.
 */
export type OperationRecord = OperationAccepted | ModelAttempted | UsageSettled | ToolDispatched | InputQueued | OperationFinished;

/** Input accepted by the Host but not yet present in the Session Journal. */
export interface PendingOperationInput {
	readonly inputId: string;
	readonly delivery: OperationInputDelivery;
	readonly inputEntryId: string;
	readonly text: string;
}

export interface OperationRecoveryEvidence {
	/** All durable Session Journal entry ids visible to the recovery reducer. */
	readonly sessionEntryIds: ReadonlySet<string>;
	/**
	 * Trusted Host-derived outcomes for durable assistant entries that end an
	 * Operation. The core deliberately does not interpret provider messages or
	 * product run policy; it only reduces this evidence with the Operation Log.
	 */
	readonly terminalOutcomeByAssistantEntryId: ReadonlyMap<string, OperationTerminalOutcome>;
}

export type OperationRecoveryVerdict =
	| { readonly status: "ready"; readonly operationId: string; readonly pendingInputs?: readonly PendingOperationInput[] }
	| {
			readonly status: "provider_interrupted";
			readonly operationId: string;
			readonly attemptId: string;
			readonly pendingInputs?: readonly PendingOperationInput[];
	  }
	| {
			readonly status: "indeterminate_tool";
			readonly operationId: string;
			readonly dispatches: readonly {
				readonly toolCallId: string;
				readonly toolName: string;
				readonly resultEntryId: string;
			}[];
	  }
	| {
			readonly status: "terminal";
			readonly operationId: string;
			readonly outcome: OperationTerminalOutcome;
			/** Whether an `operation_finished` fact has already been committed. */
			readonly finalization: "durable" | "inferred";
	  };

export class OperationJournalNotFound extends TaggedError("operations.not_found")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class OperationJournalAlreadyExists extends TaggedError("operations.already_exists")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class OperationRecordDuplicate extends TaggedError("operations.duplicate_record")<{
	readonly sessionId: string;
	readonly recordType: OperationRecord["type"];
	readonly message: string;
}> {}

export class OperationCorruptedLog extends TaggedError("operations.corrupted_log")<{
	readonly message: string;
}> {}

/**
 * Append-only execution facts for one Session. The Runtime Host is the only
 * production writer; InMemoryOperationJournal exists for ephemeral execution/tests.
 */
export interface OperationJournal {
	create(sessionId: string): Promise<Result<void, OperationJournalAlreadyExists>>;
	load(sessionId: string): Promise<Result<readonly OperationRecord[], OperationJournalNotFound>>;
	append(
		sessionId: string,
		record: OperationRecord,
	): Promise<Result<void, OperationJournalNotFound | OperationRecordDuplicate>>;
}
