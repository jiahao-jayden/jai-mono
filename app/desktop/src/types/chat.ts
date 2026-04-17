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
	kind: "message";
	id: string;
	role: ChatMessageRole;
	parts: ChatMessagePart[];
}

/**
 * Shown in the chat timeline where an older slice of the conversation was
 * summarized ("context compacted"). Two states:
 *   - "streaming":  compaction is in-flight, render a pill with a shimmer
 *   - "done":       compaction finished (or loaded from history), render a static divider
 *
 * The summary text itself is intentionally NOT exposed — per product decision,
 * users can see that a compaction happened but cannot expand the contents.
 */
export interface CompactionItem {
	kind: "compaction";
	id: string;
	status: "streaming" | "done";
	timestamp: number;
}

export type ChatItem = ChatMessage | CompactionItem;

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";
