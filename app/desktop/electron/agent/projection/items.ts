import type { CodingAgentMessage } from "@jai/coding-agent";
import type {
	DesktopMessageAttachment,
	DesktopMessageItem,
	DesktopNarrationItem,
	DesktopSlashInvocation,
	DesktopSubagentItem,
	DesktopThinkingItem,
	DesktopToolActivityKind,
	DesktopToolItem,
} from "../../../shared/desktop-rpc";
import { replayActivityKind } from "./activity-kind";

/**
 * Builds the Desktop transcript items. Both the live Agent event stream and the
 * durable session snapshot go through here, so an item can only ever have one
 * shape — the two paths used to drift, most visibly over synthetic text parts.
 */

/** Item kinds an assistant message can project into. */
export type DesktopAssistantItem =
	| DesktopMessageItem
	| DesktopNarrationItem
	| DesktopThinkingItem
	| DesktopToolItem
	| DesktopSubagentItem;

export const TOOL_DETAILS_MAX = 20_000;
export const TOOL_SUMMARY_MAX = 500;
export const TOOL_ARGUMENT_SUMMARY_MAX = 240;
export const COMPACTION_SUMMARY_MAX = 500;

export const toolItemId = (toolCallId: string) => `tool:${toolCallId}`;
export const subagentItemId = (toolCallId: string) => `subagent:${toolCallId}`;

export interface ToolItemInput {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly status: DesktopToolItem["status"];
	readonly activityId: string;
	readonly turnId?: string;
	readonly activityKind: DesktopToolActivityKind;
	readonly summary?: string;
	readonly details?: string;
}

export function toolItem(input: ToolItemInput): DesktopToolItem {
	return {
		kind: "tool",
		id: toolItemId(input.toolCallId),
		turnId: input.turnId ?? toolItemId(input.toolCallId),
		activityId: input.activityId,
		toolCallId: input.toolCallId,
		toolName: input.toolName,
		activityKind: input.activityKind,
		status: input.status,
		summary: input.summary,
		...(input.details ? { details: input.details } : {}),
	};
}

export interface SubagentItemInput {
	readonly toolCallId: string;
	readonly title: string;
	readonly status: DesktopSubagentItem["status"];
	readonly turnId?: string;
	readonly activityTitle?: string;
}

export function subagentItem(input: SubagentItemInput): DesktopSubagentItem {
	return {
		kind: "subagent",
		id: subagentItemId(input.toolCallId),
		turnId: input.turnId ?? subagentItemId(input.toolCallId),
		toolCallId: input.toolCallId,
		title: input.title,
		status: input.status,
		...(input.activityTitle ? { activityTitle: input.activityTitle } : {}),
	};
}

export interface UserMessageItemInput {
	readonly id: string;
	readonly entryId?: string;
	readonly message: CodingAgentMessage;
	readonly status: DesktopMessageItem["status"];
}

export function userMessageItem({ id, entryId, message, status }: UserMessageItemInput): DesktopMessageItem {
	const slashInvocation = slashInvocationOf(message);
	const attachments = attachmentsOf(message);
	return {
		kind: "message",
		id,
		...(entryId ? { entryId } : {}),
		role: message.role,
		text: messageText(message),
		status,
		timestamp: message.timestamp,
		...(message.role === "assistant" ? { stopReason: message.stopReason } : {}),
		...(slashInvocation ? { slashInvocation } : {}),
		...(attachments ? { attachments } : {}),
	};
}

interface AssistantPartInput {
	readonly message: Extract<CodingAgentMessage, { role: "assistant" }>;
	readonly messageId: string;
	readonly turnId: string;
	readonly contentIndex: number;
	readonly status: DesktopMessageItem["status"];
}

/** Projects one content part of an assistant message, or nothing if it carries no UI meaning. */
export function assistantPartItem({
	message,
	messageId,
	turnId,
	contentIndex,
	status,
}: AssistantPartInput): DesktopAssistantItem | undefined {
	const part = message.content[contentIndex];
	if (!part) return undefined;
	if (part.type === "thinking") {
		if (!part.thinking) return undefined;
		return {
			kind: "thinking",
			id: `thinking:${messageId}:${contentIndex}`,
			turnId,
			activityId: messageId,
			text: part.thinking,
			status,
			timestamp: message.timestamp,
		};
	}
	if (part.type === "toolCall") {
		if (part.name === "UpdateTodos") return undefined;
		if (part.name === "SpawnAgent") {
			const title = stringArgument(part.arguments, "title");
			if (!title) return undefined;
			return subagentItem({ toolCallId: part.id, turnId, title, status: "running" });
		}
		return toolItem({
			toolCallId: part.id,
			turnId,
			activityId: messageId,
			toolName: part.name,
			activityKind: replayActivityKind(part.name),
			status: "running",
			summary: summarizeToolArguments(part.name, part.arguments),
		});
	}
	if (part.type !== "text" || part.synthetic || !part.text) return undefined;
	const base = {
		id: `${messageId}:${contentIndex}`,
		text: part.text,
		status,
		timestamp: message.timestamp,
	};
	if (message.stopReason === "toolUse" || message.content.some((candidate) => candidate.type === "toolCall")) {
		return { kind: "narration", turnId, activityId: messageId, ...base };
	}
	return { kind: "message", role: "assistant", stopReason: message.stopReason, ...base };
}

/** True when a user message carries nothing but synthetic text, which never reaches the transcript. */
export function isSyntheticOnlyMessage(message: CodingAgentMessage): boolean {
	return (
		message.role === "user" &&
		Array.isArray(message.content) &&
		message.content.length > 0 &&
		message.content.every((part) => part.type === "text" && part.synthetic)
	);
}

/** Synthetic parts are prompt scaffolding, so they stay out of the text the user reads. */
export function messageText(message: CodingAgentMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : [])).join("");
}

export function summarizeToolArguments(toolName: string, args: unknown): string | undefined {
	if (!isRecord(args)) return undefined;
	const command = toolName === "Bash" ? stringArgument(args, "command") : undefined;
	const skill = toolName === "Skill" ? stringArgument(args, "skill") : undefined;
	const action = stringArgument(args, "actionId");
	const query = stringArgument(args, "query");
	const path = stringArgument(args, "path");
	return truncate(
		command ?? (skill ? `/${skill}` : undefined) ?? action ?? query ?? path ?? toolName,
		TOOL_ARGUMENT_SUMMARY_MAX,
	);
}

/** Extracts the readable text of a tool result, whether live (`{content}`) or durable (an array). */
export function toolResultText(result: unknown, maxLength: number = TOOL_DETAILS_MAX): string | undefined {
	const content = Array.isArray(result) ? result : isRecord(result) ? result.content : undefined;
	if (!Array.isArray(content)) return undefined;
	const text = content
		.filter(
			(part): part is { type: "text"; text: string } =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n");
	return text ? truncate(text, maxLength) : undefined;
}

export function spawnAgentDetails(
	value: unknown,
):
	| { readonly title: string; readonly status: DesktopSubagentItem["status"]; readonly activityTitle?: string }
	| undefined {
	if (!isRecord(value)) return undefined;
	const title = stringArgument(value, "title");
	const status = value.status;
	if (!title || (status !== "running" && status !== "complete" && status !== "error")) return undefined;
	const activityTitle = stringArgument(value, "activityTitle");
	return { title, status, ...(activityTitle ? { activityTitle } : {}) };
}

export function attachmentsOf(message: CodingAgentMessage): readonly DesktopMessageAttachment[] | undefined {
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

export function slashInvocationOf(message: CodingAgentMessage): DesktopSlashInvocation | undefined {
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

export function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function stringArgument(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
