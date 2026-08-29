import { TaggedError } from "better-result";

export type TrajectoryContentScope = "prompt" | "final_text" | "reasoning" | "tool_input" | "tool_output";

export interface TrajectoryReadAccess {
	readonly sessionId: string;
}

export interface TrajectorySessionMetadata {
	readonly sessionId: string;
	readonly cwd: string;
	readonly title?: string;
	readonly project?: { readonly id: string; readonly displayName: string };
}

export interface TrajectoryCursor {
	readonly value: string;
}

export type TrajectoryItem =
	| {
			readonly id: string;
			readonly parentId?: string;
			readonly cursor: TrajectoryCursor;
			readonly timestamp: string;
			readonly type: "live_chunk";
			readonly chunk: {
				readonly messageId: string;
				readonly channel: "agent" | "thought" | "tool";
				readonly text: string;
			};
	  }
	| {
			readonly id: string;
			readonly parentId?: string;
			readonly cursor: TrajectoryCursor;
			readonly timestamp: string;
			readonly type: "message";
			readonly message: {
				readonly entryId: string;
				readonly role: "user" | "assistant" | "toolResult";
				readonly parentId: string | null;
				readonly text?: string;
				readonly reasoning?: string;
				readonly toolCall?: {
					readonly id: string;
					readonly name: string;
					readonly input?: Record<string, unknown>;
				};
				readonly toolResult?: {
					readonly toolCallId: string;
					readonly toolName: string;
					readonly output?: string;
					readonly isError: boolean;
				};
			};
	  }
	| {
			readonly id: string;
			readonly parentId?: string;
			readonly cursor: TrajectoryCursor;
			readonly timestamp: string;
			readonly type: "journal";
			readonly journal: Readonly<Record<string, unknown>>;
	  };

export interface TrajectorySnapshot {
	readonly session: TrajectorySessionMetadata;
	readonly cursor: TrajectoryCursor;
	readonly items: readonly TrajectoryItem[];
}

export interface TrajectorySubscription {
	close(): void;
}

export class TrajectoryAccessDenied extends TaggedError("trajectory.access_denied")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class TrajectoryCursorExpired extends TaggedError("trajectory.cursor_expired")<{
	readonly sessionId: string;
	readonly cursor: string;
	readonly message: string;
}> {}

export class TrajectoryReadFailed extends TaggedError("trajectory.read_failed")<{
	readonly sessionId: string;
	readonly message: string;
	cause?: unknown;
}> {}

export type TrajectoryReadError = TrajectoryAccessDenied | TrajectoryCursorExpired | TrajectoryReadFailed;

/** The only public read seam consumed by the HTTP and ACP adapters. */
export interface TrajectoryFeed {
	snapshot(
		access: TrajectoryReadAccess,
	): Promise<import("better-result").Result<TrajectorySnapshot, TrajectoryReadError>>;
	subscribe(
		access: TrajectoryReadAccess,
		cursor: TrajectoryCursor,
		listener: (item: TrajectoryItem) => void,
	): Promise<import("better-result").Result<TrajectorySubscription, TrajectoryReadError>>;
}
