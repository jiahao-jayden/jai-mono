import type { AgentMessage } from "./types";

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
			const result = results.get(part.id);
			if (result) projected.push(result);
		}
	}

	return projected;
}
