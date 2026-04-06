export type ChatMessageRole = "user" | "assistant";

export interface ChatMessagePart {
	type: "text" | "reasoning" | "tool_call";
	text?: string;
	toolCall?: {
		toolCallId: string;
		name: string;
		status: "pending" | "running" | "completed" | "error";
	};
}

export interface ChatMessage {
	id: string;
	role: ChatMessageRole;
	parts: ChatMessagePart[];
}

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export interface SessionInfo {
	sessionId: string;
	state: "idle" | "running" | "aborted";
	createdAt: number;
}

export interface ModelInfo {
	id: string;
	provider: string;
}
