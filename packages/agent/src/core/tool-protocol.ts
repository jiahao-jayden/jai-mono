import type { ToolResultMessage } from "@jai/ai";
import type { AgentMessage } from "./types";

export interface UnresolvedToolCall {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly timestamp: number;
}

export function findUnresolvedToolCalls(messages: readonly AgentMessage[]): UnresolvedToolCall[] {
	const completed = new Set(
		messages.flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])),
	);
	return messages.flatMap((message) => {
		if (message.role !== "assistant") return [];
		return message.content.flatMap((part) =>
			part.type === "toolCall" && !completed.has(part.id)
				? [{ toolCallId: part.id, toolName: part.name, timestamp: message.timestamp }]
				: [],
		);
	});
}

export function interruptedToolResult(call: UnresolvedToolCall): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: call.toolCallId,
		toolName: call.toolName,
		content: [{ type: "text", text: "Tool execution was interrupted before completion." }],
		isError: true,
		timestamp: call.timestamp,
	};
}

export function projectToolCallProtocol(messages: readonly AgentMessage[]): AgentMessage[] {
	const results = new Map(
		messages.flatMap((message) => (message.role === "toolResult" ? ([[message.toolCallId, message]] as const) : [])),
	);
	const projected: AgentMessage[] = [];

	for (const message of messages) {
		if (message.role === "toolResult") continue;
		if (message.role === "assistant" && message.content.length === 0) continue;
		projected.push(message);
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type !== "toolCall") continue;
			projected.push(
				results.get(part.id) ??
					interruptedToolResult({
						toolCallId: part.id,
						toolName: part.name,
						timestamp: message.timestamp,
					}),
			);
		}
	}

	return projected;
}
