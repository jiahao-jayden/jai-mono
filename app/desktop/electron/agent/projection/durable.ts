import { type CodingAgentMessage, codingAgentToolNames, codingArtifactsFromAppState } from "@jai/coding-agent";
import type { CodingSessionSnapshot } from "@jai/coding-agent/business";
import type {
	DesktopAgentSnapshot,
	DesktopArtifact,
	DesktopCompactionItem,
	DesktopTodos,
	DesktopTranscriptItem,
} from "../../../shared/desktop-rpc";
import { sortArtifacts } from "../artifacts";
import {
	assistantPartItem,
	COMPACTION_SUMMARY_MAX,
	type DesktopAssistantItem,
	isRecord,
	isSyntheticOnlyMessage,
	subagentItemId,
	TOOL_SUMMARY_MAX,
	toolItem,
	toolItemId,
	toolResultText,
	truncate,
	userMessageItem,
} from "./items";

/** Replays a persisted session into the same transcript items the live path emits. */
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
				summary: truncate(entry.summary, COMPACTION_SUMMARY_MAX),
				timestamp: parseTimestamp(entry.timestamp),
			};
			items.set(item.id, item);
			continue;
		}
		if (entry.type !== "message") continue;

		if (entry.message.role === "assistant") {
			for (const item of assistantItems(entry.id, entry.message, currentTurnId)) items.set(item.id, item);
			continue;
		}

		if (entry.message.role === "toolResult") {
			if (entry.message.toolName === codingAgentToolNames.updateTodos) continue;
			if (entry.message.toolName === codingAgentToolNames.spawnAgent) {
				const existing = items.get(subagentItemId(entry.message.toolCallId));
				if (existing?.kind !== "subagent") continue;
				items.set(existing.id, { ...existing, status: entry.message.isError ? "error" : "complete" });
				continue;
			}
			const existing = items.get(toolItemId(entry.message.toolCallId));
			const existingTool = existing?.kind === "tool" ? existing : undefined;
			const details = toolResultText(entry.message.content);
			const item = toolItem({
				toolCallId: entry.message.toolCallId,
				turnId: existingTool?.turnId,
				toolName: entry.message.toolName,
				status: "complete",
				summary: existingTool?.summary ?? (details ? truncate(details, TOOL_SUMMARY_MAX) : undefined),
				...(details ? { details } : {}),
			});
			items.set(item.id, item);
			continue;
		}

		if (isSyntheticOnlyMessage(entry.message)) continue;
		const messageItem = userMessageItem({
			id: `message:${entry.id}`,
			message: entry.message,
			status: "complete",
		});
		items.set(messageItem.id, messageItem);
		if (entry.message.role === "user") currentTurnId = messageItem.id;
	}

	// A subagent still marked running in a persisted session never finished.
	const projectedItems = [...items.values()].map(
		(item): DesktopTranscriptItem =>
			item.kind === "subagent" && item.status === "running"
				? { ...item, status: "error", activityTitle: "Interrupted" }
				: item,
	);

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

function assistantItems(
	entryId: string,
	message: Extract<CodingAgentMessage, { role: "assistant" }>,
	currentTurnId: string | undefined,
): DesktopAssistantItem[] {
	const turnId = currentTurnId ?? `message:${entryId}`;
	return message.content.flatMap((_, contentIndex) => {
		const item = assistantPartItem({
			message,
			messageId: `message:${entryId}`,
			turnId,
			contentIndex,
			status: "complete",
		});
		return item ? [item] : [];
	});
}

/** Reads the Todo read-model out of Session App State, rejecting anything malformed. */
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

function parseTimestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}
