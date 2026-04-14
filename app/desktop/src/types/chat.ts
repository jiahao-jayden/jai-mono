export type ChatMessageRole = "user" | "assistant";

export interface ChatAttachment {
	id: string;
	filename: string;
	mimeType: string;
	size: number;
	/** blob: URL for local preview (images) */
	previewUrl?: string;
	/** data: URL after conversion (for sending to gateway) */
	dataUrl?: string;
}

export interface ChatMessagePart {
	type: "text" | "reasoning" | "tool_call" | "error" | "attachment";
	text?: string;
	toolCall?: {
		toolCallId: string;
		name: string;
		status: "pending" | "running" | "completed" | "error";
		args?: string;
		result?: string;
	};
	attachment?: ChatAttachment;
}

export interface ChatMessage {
	id: string;
	role: ChatMessageRole;
	parts: ChatMessagePart[];
}

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";
