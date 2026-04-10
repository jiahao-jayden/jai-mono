export type ChatMessageRole = "user" | "assistant";

export interface ChatMessagePart {
	type: "text" | "reasoning" | "tool_call" | "error";
	text?: string;
	toolCall?: {
		toolCallId: string;
		name: string;
		status: "pending" | "running" | "completed" | "error";
		args?: string;
		result?: string;
	};
}

export interface ChatMessage {
	id: string;
	role: ChatMessageRole;
	parts: ChatMessagePart[];
}

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";
