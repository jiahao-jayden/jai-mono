import type { CodingAgentEvent } from "@jai/coding-agent";
import type { DesktopToolItem, DesktopTranscriptItem } from "../../../shared/desktop-rpc";
import {
	assistantPartItem,
	type DesktopAssistantItem,
	isRecord,
	spawnAgentDetails,
	stringArgument,
	subagentItem,
	subagentItemId,
	summarizeToolArguments,
	TOOL_SUMMARY_MAX,
	toolItem,
	toolItemId,
	toolResultText,
	truncate,
} from "./items";

/**
 * What a live Agent event means for the transcript, decided without reference to
 * sequencing, throttling, or emission — the host owns those.
 */
export type LiveProjection =
	| { readonly kind: "none" }
	/** Replace these items and send each immediately. */
	| { readonly kind: "items"; readonly items: readonly DesktopTranscriptItem[] }
	/** A streaming part that may be coalesced inside the throttle window. */
	| { readonly kind: "streaming"; readonly item: DesktopTranscriptItem }
	/** Todos changed in Session App State. */
	| { readonly kind: "todos" };

/** Everything the projection needs to know about the session it belongs to. */
export interface LiveProjectionContext {
	readonly turnId?: string;
	/** Resolves the transcript id for the message currently streaming. */
	messageId(role: "assistant" | "user"): string;
	/** The item already in the transcript under this id, if any. */
	existing(id: string): DesktopTranscriptItem | undefined;
}

/** Projects one part of an assistant message during streaming. */
export function projectMessageUpdate(
	event: Extract<CodingAgentEvent, { type: "message_update" }>,
	context: LiveProjectionContext,
): LiveProjection {
	if (!("contentIndex" in event.assistantEvent)) return { kind: "none" };
	const messageId = context.messageId("assistant");
	const item = assistantPartItem({
		message: event.message,
		messageId,
		turnId: context.turnId ?? messageId,
		contentIndex: event.assistantEvent.contentIndex,
		status: event.assistantEvent.type === "thinking_end" ? "complete" : "streaming",
	});
	// Tool parts arrive again through tool_execution_*, which carries their result.
	if (!item || item.kind === "tool") return { kind: "none" };
	return event.assistantEvent.type === "thinking_end" ? { kind: "items", items: [item] } : { kind: "streaming", item };
}

/** Projects a tool call that just started running. */
export function projectToolStart(
	event: Extract<CodingAgentEvent, { type: "tool_execution_start" }>,
	context: LiveProjectionContext,
): LiveProjection {
	if (event.toolName === "UpdateTodos") return { kind: "none" };

	if (event.toolName === "SpawnAgent") {
		const previous = subagentOf(context, event.toolCallId);
		const title = (isRecord(event.args) ? stringArgument(event.args, "title") : undefined) ?? previous?.title;
		if (!title) return { kind: "none" };
		return {
			kind: "items",
			items: [
				subagentItem({
					toolCallId: event.toolCallId,
					turnId: previous?.turnId,
					title,
					status: "running",
					...(previous?.activityTitle ? { activityTitle: previous.activityTitle } : {}),
				}),
			],
		};
	}

	return {
		kind: "items",
		items: [
			toolItem({
				toolCallId: event.toolCallId,
				turnId: toolOf(context, event.toolCallId)?.turnId,
				toolName: event.toolName,
				status: "running",
				summary: summarizeToolArguments(event.toolName, event.args),
			}),
		],
	};
}

/** Projects a tool call that produced a partial or final result. */
export function projectToolProgress(
	event: Extract<CodingAgentEvent, { type: "tool_execution_update" | "tool_execution_end" }>,
	context: LiveProjectionContext,
): LiveProjection {
	if (event.toolName === "UpdateTodos") {
		return event.type === "tool_execution_end" && !event.isError ? { kind: "todos" } : { kind: "none" };
	}

	const result = event.type === "tool_execution_update" ? event.partial : event.result;

	if (event.toolName === "SpawnAgent") {
		const previous = subagentOf(context, event.toolCallId);
		const details = spawnAgentDetails(isRecord(result) ? result.details : undefined);
		const title = details?.title ?? previous?.title;
		if (!title) return { kind: "none" };
		const status =
			event.type === "tool_execution_update" ? (details?.status ?? "running") : event.isError ? "error" : "complete";
		const activityTitle = details?.activityTitle ?? previous?.activityTitle;
		return {
			kind: "items",
			items: [
				subagentItem({
					toolCallId: event.toolCallId,
					turnId: previous?.turnId,
					title,
					status,
					...(activityTitle ? { activityTitle } : {}),
				}),
			],
		};
	}

	const previous = toolOf(context, event.toolCallId);
	const details = toolResultText(result);
	return {
		kind: "items",
		items: [
			toolItem({
				toolCallId: event.toolCallId,
				turnId: previous?.turnId,
				toolName: event.toolName,
				status: event.type === "tool_execution_update" ? "running" : "complete",
				summary: previous?.summary ?? (details ? truncate(details, TOOL_SUMMARY_MAX) : undefined),
				...(details ? { details } : previous?.details ? { details: previous.details } : {}),
			}),
		],
	};
}

function toolOf(context: LiveProjectionContext, toolCallId: string): DesktopToolItem | undefined {
	const item = context.existing(toolItemId(toolCallId));
	return item?.kind === "tool" ? item : undefined;
}

function subagentOf(context: LiveProjectionContext, toolCallId: string) {
	const item = context.existing(subagentItemId(toolCallId));
	return item?.kind === "subagent" ? item : undefined;
}

export type { DesktopAssistantItem };
