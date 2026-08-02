import type { AgentMessage, SessionSnapshot } from "@jai/agent";
import type {
	DesktopAgentSnapshot,
	DesktopCompactionItem,
	DesktopMessageItem,
	DesktopSlashInvocation,
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
	const slashInvocation = projectSlashInvocation(message);
	return {
		kind: "message",
		id: `message:${entryId}`,
		role: message.role,
		text: messageText(message),
		status: "complete",
		timestamp: message.timestamp,
		...(message.role === "assistant" ? { stopReason: message.stopReason } : {}),
		...(slashInvocation ? { slashInvocation } : {}),
	};
}

export function projectSlashInvocation(message: AgentMessage): DesktopSlashInvocation | undefined {
	if (message.role !== "user") return undefined;
	const value = message.metadata?.slashInvocation;
	if (!isRecord(value)) return undefined;
	if (
		typeof value.name !== "string" ||
		(value.kind !== "skill" && value.kind !== "command") ||
		typeof value.displayName !== "string"
	) {
		return undefined;
	}
	return { name: value.name, kind: value.kind, displayName: value.displayName };
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
	const key = toolName === "Bash" ? "command" : toolName === "Skill" ? "skill" : "path";
	const value = args[key];
	const summary = typeof value === "string" && value ? value : toolName;
	return truncate(toolName === "Skill" && summary !== toolName ? `/${summary}` : summary, 240);
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
