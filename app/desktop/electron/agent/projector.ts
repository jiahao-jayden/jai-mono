import type { AgentMessage, SessionSnapshot } from "@jai/agent";
import type {
	DesktopAgentSnapshot,
	DesktopCompactionItem,
	DesktopMessageItem,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";

export function projectSessionSnapshot(sessionId: string, snapshot: SessionSnapshot): DesktopAgentSnapshot {
	const items = new Map<string, DesktopTranscriptItem>();
	for (const entry of snapshot.entries) {
		if (entry.type === "compaction") {
			const item: DesktopCompactionItem = {
				kind: "compaction",
				id: `compaction:${entry.id}`,
				summary: truncate(entry.summary, 500),
				timestamp: parseTimestamp(entry.timestamp),
			};
			items.set(item.id, item);
			continue;
		}
		if (entry.type !== "message") continue;
		const messageItem = projectMessage(entry.id, entry.message);
		items.set(messageItem.id, messageItem);
		if (entry.message.role === "assistant") {
			for (const part of entry.message.content) {
				if (part.type !== "toolCall") continue;
				const toolItem: DesktopToolItem = {
					kind: "tool",
					id: `tool:${part.id}`,
					toolCallId: part.id,
					toolName: part.name,
					status: "running",
					summary: summarizeToolArguments(part.name, part.arguments),
				};
				items.set(toolItem.id, toolItem);
			}
		}
		if (entry.message.role === "toolResult") {
			const existing = items.get(`tool:${entry.message.toolCallId}`);
			const toolItem: DesktopToolItem = {
				kind: "tool",
				id: `tool:${entry.message.toolCallId}`,
				toolCallId: entry.message.toolCallId,
				toolName: entry.message.toolName,
				status: entry.message.isError ? "error" : "complete",
				summary:
					textContent(entry.message.content, 500) || (existing?.kind === "tool" ? existing.summary : undefined),
			};
			items.set(toolItem.id, toolItem);
		}
	}
	return {
		sessionId,
		status: "idle",
		items: [...items.values()],
		lastSeq: 0,
	};
}

function projectMessage(entryId: string, message: AgentMessage): DesktopMessageItem {
	return {
		kind: "message",
		id: `message:${entryId}`,
		role: message.role,
		text: messageText(message),
		status: "complete",
		timestamp: message.timestamp,
		...(message.role === "assistant" ? { stopReason: message.stopReason } : {}),
	};
}

function messageText(message: AgentMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.flatMap((part) => {
			if (part.type === "text") return [part.text];
			if (part.type === "thinking") return [part.thinking];
			return [];
		})
		.join("");
}

function summarizeToolArguments(toolName: string, args: Readonly<Record<string, unknown>>): string {
	const key = toolName === "Bash" ? "command" : "path";
	const value = args[key];
	return truncate(typeof value === "string" && value ? value : toolName, 240);
}

function textContent(content: readonly unknown[], maxLength: number): string {
	const text = content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
	return text ? truncate(text, maxLength) : "";
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function parseTimestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}
