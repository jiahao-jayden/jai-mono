import { type CodingAgentMessage, codingAgentToolNames, codingArtifactsFromAppState } from "@jai/coding-agent";
import type { CodingSessionSnapshot } from "@jai/coding-agent/business";
import type {
	DesktopAgentSnapshot,
	DesktopArtifact,
	DesktopCompactionItem,
	DesktopMessageAttachment,
	DesktopMessageItem,
	DesktopNarrationItem,
	DesktopSlashInvocation,
	DesktopSubagentItem,
	DesktopThinkingItem,
	DesktopTodos,
	DesktopToolItem,
	DesktopTranscriptItem,
} from "../../shared/desktop-rpc";
import { sortArtifacts } from "./artifacts";
import { projectAssistantPart } from "./assistant-projector";

export function projectSessionSnapshot(sessionId: string, snapshot: CodingSessionSnapshot): DesktopAgentSnapshot {
	const items = new Map<string, DesktopTranscriptItem>();
	const artifacts = new Map<string, DesktopArtifact>(
		codingArtifactsFromAppState(snapshot.appState).map((artifact) => [artifact.id, artifact]),
	);
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
			for (const item of projectAssistantItems(entry.id, entry.message, currentTurnId)) {
				items.set(item.id, item);
			}
			continue;
		}
		if (entry.message.role === "toolResult") {
			if (entry.message.toolName === codingAgentToolNames.updateTodos) {
				continue;
			}
			if (entry.message.toolName === codingAgentToolNames.spawnAgent) {
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
				status: "complete",
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
		artifacts: sortArtifacts(artifacts.values()),
		lastSeq: 0,
	};
}

function projectAssistantItems(
	entryId: string,
	message: Extract<CodingAgentMessage, { role: "assistant" }>,
	currentTurnId: string | undefined,
): (DesktopMessageItem | DesktopNarrationItem | DesktopThinkingItem | DesktopToolItem | DesktopSubagentItem)[] {
	const result: (
		| DesktopMessageItem
		| DesktopNarrationItem
		| DesktopThinkingItem
		| DesktopToolItem
		| DesktopSubagentItem
	)[] = [];
	const turnId = currentTurnId ?? `message:${entryId}`;

	for (const [contentIndex] of message.content.entries()) {
		const item = projectAssistantPart({
			message,
			messageId: `message:${entryId}`,
			turnId,
			contentIndex,
			status: "complete",
		});
		if (item) result.push(item);
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

function projectMessage(entryId: string, message: CodingAgentMessage): DesktopMessageItem {
	const slashInvocation = projectSlashInvocation(message);
	const attachments = projectMessageAttachments(message);
	return {
		kind: "message",
		id: `message:${entryId}`,
		role: message.role,
		text: messageText(message),
		status: "complete",
		timestamp: message.timestamp,
		...(message.role === "assistant" ? { stopReason: message.stopReason } : {}),
		...(slashInvocation ? { slashInvocation } : {}),
		...(attachments ? { attachments } : {}),
	};
}

export function projectMessageAttachments(
	message: CodingAgentMessage,
): readonly DesktopMessageAttachment[] | undefined {
	if (message.role !== "user") return undefined;
	const value = message.metadata?.messageAttachments;
	if (!Array.isArray(value)) return undefined;
	const attachments = value.flatMap((candidate) => {
		if (!isRecord(candidate)) return [];
		if (
			typeof candidate.id !== "string" ||
			typeof candidate.filename !== "string" ||
			typeof candidate.mimeType !== "string" ||
			typeof candidate.size !== "number" ||
			!Number.isInteger(candidate.size) ||
			candidate.size < 0
		) {
			return [];
		}
		return [
			{
				id: candidate.id,
				filename: candidate.filename,
				mimeType: candidate.mimeType,
				size: candidate.size,
			} satisfies DesktopMessageAttachment,
		];
	});
	return attachments.length === value.length ? attachments : undefined;
}

export function projectSlashInvocation(message: CodingAgentMessage): DesktopSlashInvocation | undefined {
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

function messageText(message: CodingAgentMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.flatMap((part) => {
			if (part.type === "text" && !part.synthetic) return [part.text];
			return [];
		})
		.join("");
}

function isSyntheticOnlyMessage(message: CodingAgentMessage): boolean {
	return (
		message.role === "user" &&
		Array.isArray(message.content) &&
		message.content.length > 0 &&
		message.content.every((part) => part.type === "text" && part.synthetic)
	);
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
