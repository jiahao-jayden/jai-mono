import type { Message } from "@jayden/jai-ai";

// ── AG-UI Event Type Enum ────────────────────────────────────

export const AGUIEventType = {
	RUN_STARTED: "RUN_STARTED",
	RUN_FINISHED: "RUN_FINISHED",
	RUN_ERROR: "RUN_ERROR",

	TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
	TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
	TEXT_MESSAGE_END: "TEXT_MESSAGE_END",

	TOOL_CALL_START: "TOOL_CALL_START",
	TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
	TOOL_CALL_END: "TOOL_CALL_END",
	TOOL_CALL_RESULT: "TOOL_CALL_RESULT",

	REASONING_START: "REASONING_START",
	REASONING_CONTENT: "REASONING_CONTENT",
	REASONING_END: "REASONING_END",

	MESSAGES_SNAPSHOT: "MESSAGES_SNAPSHOT",
} as const;

export type AGUIEventType = (typeof AGUIEventType)[keyof typeof AGUIEventType];

// ── Lifecycle Events ─────────────────────────────────────────

export type RunStartedEvent = {
	type: typeof AGUIEventType.RUN_STARTED;
	threadId: string;
	runId: string;
};

export type RunFinishedEvent = {
	type: typeof AGUIEventType.RUN_FINISHED;
	threadId: string;
	runId: string;
};

export type RunErrorEvent = {
	type: typeof AGUIEventType.RUN_ERROR;
	message: string;
	code?: string;
};

// ── Text Message Events ──────────────────────────────────────

export type TextMessageStartEvent = {
	type: typeof AGUIEventType.TEXT_MESSAGE_START;
	messageId: string;
	role: "assistant";
};

export type TextMessageContentEvent = {
	type: typeof AGUIEventType.TEXT_MESSAGE_CONTENT;
	messageId: string;
	delta: string;
};

export type TextMessageEndEvent = {
	type: typeof AGUIEventType.TEXT_MESSAGE_END;
	messageId: string;
};

// ── Tool Call Events ─────────────────────────────────────────

export type ToolCallStartEvent = {
	type: typeof AGUIEventType.TOOL_CALL_START;
	toolCallId: string;
	toolCallName: string;
	parentMessageId?: string;
};

export type ToolCallArgsEvent = {
	type: typeof AGUIEventType.TOOL_CALL_ARGS;
	toolCallId: string;
	delta: string;
};

export type ToolCallEndEvent = {
	type: typeof AGUIEventType.TOOL_CALL_END;
	toolCallId: string;
};

export type ToolCallResultEvent = {
	type: typeof AGUIEventType.TOOL_CALL_RESULT;
	toolCallId: string;
	content: string;
};

// ── Reasoning Events ─────────────────────────────────────────

export type ReasoningStartEvent = {
	type: typeof AGUIEventType.REASONING_START;
	messageId: string;
};

export type ReasoningContentEvent = {
	type: typeof AGUIEventType.REASONING_CONTENT;
	messageId: string;
	delta: string;
};

export type ReasoningEndEvent = {
	type: typeof AGUIEventType.REASONING_END;
	messageId: string;
};

// ── State Events ─────────────────────────────────────────────

export type MessagesSnapshotEvent = {
	type: typeof AGUIEventType.MESSAGES_SNAPSHOT;
	messages: Message[];
};

// ── Union Type ───────────────────────────────────────────────

export type AGUIEvent =
	| RunStartedEvent
	| RunFinishedEvent
	| RunErrorEvent
	| TextMessageStartEvent
	| TextMessageContentEvent
	| TextMessageEndEvent
	| ToolCallStartEvent
	| ToolCallArgsEvent
	| ToolCallEndEvent
	| ToolCallResultEvent
	| ReasoningStartEvent
	| ReasoningContentEvent
	| ReasoningEndEvent
	| MessagesSnapshotEvent;
