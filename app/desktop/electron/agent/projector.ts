import type { AgentMessage, SessionSnapshot } from "@jai/agent";
import { REPORT_PROGRESS_TOOL_NAME, SPAWN_AGENT_TOOL_NAME, UPDATE_TODOS_TOOL_NAME } from "@jai/coding/tools";
import type {
	DesktopAgentSnapshot,
	DesktopCompactionItem,
	DesktopMessageItem,
	DesktopProgressItem,
	DesktopSlashInvocation,
	DesktopSubagentItem,
	DesktopThinkingItem,
	DesktopTodos,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";

export function projectSessionSnapshot(sessionId: string, snapshot: SessionSnapshot): DesktopAgentSnapshot {
	const items = new Map<string, DesktopTranscriptItem>();
	let currentTurnId: string | undefined;
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
		if (entry.message.role === "assistant") {
			const progress = entry.message.content.find(
				(part) => part.type === "toolCall" && part.name === REPORT_PROGRESS_TOOL_NAME,
			);
			if (progress?.type === "toolCall") currentTurnId = `progress:${progress.id}`;
			for (const item of projectAssistantItems(entry.id, entry.message, currentTurnId)) {
				items.set(item.id, item);
			}
			continue;
		}
		if (entry.message.role === "toolResult") {
			if (
				entry.message.toolName === REPORT_PROGRESS_TOOL_NAME ||
				entry.message.toolName === UPDATE_TODOS_TOOL_NAME
			) {
				continue;
			}
			if (entry.message.toolName === SPAWN_AGENT_TOOL_NAME) {
				const existing = items.get(`subagent:${entry.message.toolCallId}`);
				if (existing?.kind !== "subagent") continue;
				const item: DesktopSubagentItem = {
					...existing,
					status: entry.message.isError ? "error" : "complete",
				};
				items.set(item.id, item);
				continue;
			}
			const existing = items.get(`tool:${entry.message.toolCallId}`);
			const existingTool = existing?.kind === "tool" ? existing : undefined;
			const details = textContent(entry.message.content, 20_000);
			const toolItem: DesktopToolItem = {
				kind: "tool",
				id: `tool:${entry.message.toolCallId}`,
				turnId: existingTool?.turnId ?? `tool:${entry.message.toolCallId}`,
				toolCallId: entry.message.toolCallId,
				toolName: entry.message.toolName,
				status: entry.message.isError ? "error" : "complete",
				summary: existingTool?.summary ?? (details ? truncate(details, 500) : undefined),
				...(details ? { details } : {}),
			};
			items.set(toolItem.id, toolItem);
			continue;
		}
		if (isSyntheticOnlyMessage(entry.message)) continue;
		const messageItem = projectMessage(entry.id, entry.message);
		items.set(messageItem.id, messageItem);
		if (entry.message.role === "user") currentTurnId = messageItem.id;
	}
	const projectedItems = [...items.values()].map((item): DesktopTranscriptItem => {
		if (item.kind !== "subagent" || item.status !== "running") return item;
		return {
			...item,
			status: "error",
			activityTitle: "Interrupted",
		};
	});
	const todos = projectSessionTodos(snapshot.appState.todos);
	return {
		sessionId,
		status: "idle",
		items: projectedItems,
		...(todos ? { todos } : {}),
		lastSeq: 0,
	};
}

function projectAssistantItems(
	entryId: string,
	message: Extract<AgentMessage, { role: "assistant" }>,
	currentTurnId: string | undefined,
): (DesktopMessageItem | DesktopThinkingItem | DesktopProgressItem | DesktopToolItem | DesktopSubagentItem)[] {
	const result: (
		| DesktopMessageItem
		| DesktopThinkingItem
		| DesktopProgressItem
		| DesktopToolItem
		| DesktopSubagentItem
	)[] = [];
	const turnId = currentTurnId ?? `message:${entryId}`;
	const text = messageText(message);
	let textProjected = false;

	for (const [contentIndex, part] of message.content.entries()) {
		if (part.type === "thinking") {
			if (!part.thinking) continue;
			result.push({
				kind: "thinking",
				id: `thinking:${entryId}:${contentIndex}`,
				turnId,
				text: part.thinking,
				status: "complete",
				timestamp: message.timestamp,
			});
			continue;
		}
		if (part.type === "toolCall") {
			if (part.name === REPORT_PROGRESS_TOOL_NAME) {
				const title = stringValue(part.arguments, "title");
				const detail = stringValue(part.arguments, "detail");
				if (title && detail) {
					result.push({
						kind: "progress",
						id: `progress:${part.id}`,
						turnId,
						title,
						detail,
						timestamp: message.timestamp,
					});
				}
				continue;
			}
			if (part.name === UPDATE_TODOS_TOOL_NAME) continue;
			if (part.name === SPAWN_AGENT_TOOL_NAME) {
				const title = stringValue(part.arguments, "title");
				if (title) {
					result.push({
						kind: "subagent",
						id: `subagent:${part.id}`,
						turnId,
						toolCallId: part.id,
						title,
						status: "running",
					});
				}
				continue;
			}
			result.push({
				kind: "tool",
				id: `tool:${part.id}`,
				turnId,
				toolCallId: part.id,
				toolName: part.name,
				status: "running",
				summary: summarizeToolArguments(part.name, part.arguments),
			});
			continue;
		}
		if (!textProjected && text) {
			result.push(projectMessage(entryId, message));
			textProjected = true;
		}
	}

	return result;
}

export function projectSessionTodos(value: unknown): DesktopTodos | undefined {
	if (!isRecord(value) || value.version !== 1 || typeof value.updatedAt !== "number" || !Array.isArray(value.items)) {
		return undefined;
	}
	const items = value.items.flatMap((candidate) => {
		if (!isRecord(candidate)) return [];
		if (typeof candidate.id !== "string" || typeof candidate.content !== "string") return [];
		if (!isTodoStatus(candidate.status)) return [];
		return [{ id: candidate.id, content: candidate.content, status: candidate.status }];
	});
	if (items.length !== value.items.length) return undefined;
	return { version: 1, updatedAt: value.updatedAt, items };
}

function isTodoStatus(value: unknown): value is DesktopTodos["items"][number]["status"] {
	return value === "pending" || value === "in_progress" || value === "completed" || value === "cancelled";
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
			if (part.type === "text" && !part.synthetic) return [part.text];
			return [];
		})
		.join("");
}

function isSyntheticOnlyMessage(message: AgentMessage): boolean {
	return (
		message.role === "user" &&
		Array.isArray(message.content) &&
		message.content.length > 0 &&
		message.content.every((part) => part.type === "text" && part.synthetic)
	);
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

function stringValue(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const candidate = value[key];
	return typeof candidate === "string" && candidate ? candidate : undefined;
}

function parseTimestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
