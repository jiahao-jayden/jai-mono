export type TrajectoryContentScope = "prompt" | "final_text" | "reasoning" | "tool_input" | "tool_output";

export interface TrajectoryCursor {
	readonly value: string;
}

export interface TrajectorySessionMetadata {
	readonly sessionId: string;
	readonly cwd: string;
	readonly title?: string;
	readonly project?: { readonly id: string; readonly displayName: string };
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

export interface TrajectoryWireError {
	readonly code:
		| "unauthorized"
		| "forbidden"
		| "origin_forbidden"
		| "invalid_scope"
		| "cursor_expired"
		| "not_found"
		| "unavailable";
	readonly message: string;
}
