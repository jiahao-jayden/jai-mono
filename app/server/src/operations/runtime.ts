import type { EffectBoundary, JsonObject, SessionStore } from "@jai/agent";
import type { Result } from "better-result";
import { TaggedError } from "better-result";
import type { RuntimeSessionConfiguration } from "../sessions";

/** The only terminal states the Runtime Host is allowed to commit for an Operation. */
export type RuntimeOperationOutcome = "completed" | "failed" | "aborted";

/** A Host-admitted user input that has not yet been written to the Session Journal. */
export interface RuntimeQueuedInput {
	readonly inputId: string;
	readonly delivery: "steer" | "follow_up";
	readonly entryId: string;
	readonly text: string;
}

/**
 * Whitelisted, disposable progress emitted by a running Operation.
 *
 * These are intentionally not a second journal: message and tool terminal
 * facts are published separately when their Session Journal entries commit.
 * The Host may drop this stream at any time and reconstruct a client from its
 * durable snapshot.
 */
export type RuntimeOperationEvent =
	/** Emitted only after the matching durable `usage_settled` ledger fact commits. */
	| {
			readonly type: "usage_settled";
			readonly cost: number;
	  }
	| {
			readonly type: "message_chunk";
			readonly messageId: string;
			readonly channel: "agent" | "thought";
			readonly text: string;
	  }
	| {
			readonly type: "message_cleared";
			readonly messageId: string;
			readonly channel: "agent" | "thought";
	  }
	| {
			readonly type: "tool_started";
			readonly toolCallId: string;
			/** Canonical SDK tool identity; display titles are not a protocol discriminator. */
			readonly toolName: string;
			readonly title: string;
			readonly kind: "read" | "edit" | "search" | "execute" | "other";
			readonly rawInput: JsonObject;
			/**
			 * A display-only terminal that exists only after the tool dispatch boundary.
			 * Its output is volatile; its terminal outcome is projected from the durable
			 * tool-result entry rather than this live event.
			 */
			readonly terminal?: {
				readonly terminalId: string;
				readonly command: string;
				readonly cwd: string;
			};
	  }
	| {
			readonly type: "tool_content_chunk";
			readonly toolCallId: string;
			readonly content: RuntimeOperationContent;
	  }
	| {
			/** Volatile UTF-8 bytes appended to a display-only agent-owned terminal. */
			readonly type: "terminal_output_chunk";
			readonly terminalId: string;
			readonly text: string;
	  }
	| {
			/** A volatile authoritative replacement when the source can only report a tail snapshot. */
			readonly type: "terminal_output";
			readonly terminalId: string;
			readonly text: string;
	  };

/** The small safe subset of SDK tool output that a Host may display live. */
export type RuntimeOperationContent =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "image"; readonly data: string; readonly mimeType: string };

export class RuntimeOperationOpenFailed extends TaggedError("runtime_operations.open_failed")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeOperationExecutionFailed extends TaggedError("runtime_operations.execution_failed")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/** Safe Server-facing projection of an SDK permission request. */
export interface RuntimeApprovalRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly operationId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly title: string;
	readonly description?: string;
	readonly risk?: "low" | "medium" | "high";
	readonly canAlwaysAllow: boolean;
	readonly rememberScope?: "session" | "project-local";
}

export type RuntimeApprovalDecision = "deny" | "allowOnce" | "alwaysAllow";

/** The Runtime Host supplies this interaction; Coding Agent never sees ACP. */
export type RuntimeApprovalHandler = (
	request: RuntimeApprovalRequest,
	signal?: AbortSignal,
) => RuntimeApprovalDecision | Promise<RuntimeApprovalDecision>;

export interface RuntimeOperationOpenInput {
	readonly sessionId: string;
	readonly cwd: string;
	readonly operationId: string;
	/** Frozen by the atomic prompt-admission transaction for this Operation. */
	readonly runtimeConfiguration: RuntimeSessionConfiguration;
	/** Server-owned adapter; Coding Agent never learns that it is backed by SQLite. */
	readonly sessionStore: SessionStore<JsonObject>;
	/** Per-operation intent-before-effect protocol supplied by the Runtime Host. */
	readonly effectBoundary: EffectBoundary;
	/** Inputs accepted before this recovered operation can reopen its live Agent. */
	readonly pendingInputs?: readonly RuntimeQueuedInput[];
	/** Current Session Controller's approval interaction, mediated by the Host. */
	readonly requestApproval: RuntimeApprovalHandler;
}

/** Read-only readiness check that must complete before prompt admission. */
export interface RuntimeOperationPreflightInput {
	readonly sessionId: string;
	readonly cwd: string;
	readonly operationId: string;
	/** Current configuration which will be frozen if prompt admission succeeds. */
	readonly runtimeConfiguration: RuntimeSessionConfiguration;
}

/** A running resource: it must be aborted and observed through this small interface. */
export interface RuntimeOperation {
	abort(): Promise<Result<void, RuntimeOperationExecutionFailed>>;
	/** Delivers an already durable input at the current Agent safe checkpoint. */
	enqueueInput?(input: RuntimeQueuedInput): Promise<Result<void, RuntimeOperationExecutionFailed>>;
	awaitOutcome(): Promise<Result<RuntimeOperationOutcome, RuntimeOperationExecutionFailed>>;
	/**
	 * Optional live-projection seam. Drivers without a live runtime (including
	 * deterministic recovery tests) need not implement it.
	 */
	subscribe?(listener: (event: RuntimeOperationEvent) => void): () => void;
	close(): Promise<void>;
}

/**
 * Product execution seam. RuntimeHost owns admission and terminal records;
 * a driver owns the live Coding Agent, provider, tools and host I/O.
 */
export interface RuntimeOperationDriver {
	/**
	 * Confirms that this operation can be opened without performing an external
	 * effect. A rejected preflight must prevent durable prompt admission.
	 */
	preflight?(input: RuntimeOperationPreflightInput): Promise<Result<void, RuntimeOperationOpenFailed>>;
	openOperation(
		input: RuntimeOperationOpenInput,
	): Promise<Result<RuntimeOperation, RuntimeOperationOpenFailed>>;
}
