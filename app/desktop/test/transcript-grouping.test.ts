import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";
import {
	groupTranscriptItems,
	TranscriptItem,
	TranscriptItems,
	workTimelineSteps,
} from "../src/components/shell/chat/chat-transcript";

describe("transcript grouping", () => {
	test("只将明确的 compaction item 渲染为上下文压缩", () => {
		const compaction: DesktopTranscriptItem = {
			kind: "compaction",
			id: "compaction:1",
			summary: "Earlier context",
			timestamp: 1,
			status: "complete",
		};
		const staleProgress = {
			kind: "progress",
			id: "progress:1",
			title: "Working",
			detail: "From an older main process",
		};

		expect(renderToStaticMarkup(createElement(TranscriptItem, { item: compaction }))).toContain("Context compacted");
		expect(
			renderToStaticMarkup(
				createElement(TranscriptItem, { item: staleProgress as unknown as DesktopTranscriptItem }),
			),
		).toBe("");
	});

	test("单个工具使用 ToolTimeline 渲染", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:search-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "search-1",
			toolName: "Grep",
			activityKind: "search",
			status: "complete",
			summary: "chat-transcript.tsx",
		};

		const markup = renderToStaticMarkup(createElement(TranscriptItem, { item: tool }));
		expect(markup).toContain('data-slot="tool-timeline"');
		expect(markup).toContain("1 step · 1 action");
	});

	test("context compaction 不会切断同一 turn 的工作日志", () => {
		const firstTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "call-1",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
		};
		const compaction: Extract<DesktopTranscriptItem, { kind: "compaction" }> = {
			kind: "compaction",
			id: "compaction:1",
			summary: "Earlier context",
			timestamp: 1,
			status: "complete",
		};
		const nextTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			...firstTool,
			id: "tool:2",
			activityId: "assistant:2",
			toolCallId: "call-2",
			toolName: "Bash",
			activityKind: "execute",
		};

		expect(groupTranscriptItems([firstTool, compaction, nextTool])).toEqual([
			{ id: "work:turn-1:tool:1", items: [firstTool, nextTool] },
		]);
		expect(groupTranscriptItems([firstTool, compaction])).toEqual([
			{ id: "work:turn-1:tool:1", items: [firstTool] },
		]);
	});

	test("未知 MCP 即使命名为 search 或 list 也只聚合为通用操作", () => {
		const items: DesktopTranscriptItem[] = [
			{
				kind: "message",
				id: "message:user-1",
				role: "user",
				text: "查询外部服务的数据",
				status: "complete",
				timestamp: 1,
			},
			{
				kind: "narration",
				id: "message:assistant-1:0",
				turnId: "message:user-1",
				activityId: "message:assistant-1",
				text: "我先确认有哪些可用操作。",
				status: "complete",
				timestamp: 2,
			},
			{
				kind: "tool",
				id: "tool:list-apps",
				turnId: "message:user-1",
				activityId: "message:assistant-1",
				toolCallId: "list-apps",
				toolName: "mcp__ext__srv__list_apps",
				activityKind: "operation",
				status: "complete",
			},
			{
				kind: "tool",
				id: "tool:list-connections",
				turnId: "message:user-1",
				activityId: "message:assistant-1",
				toolCallId: "list-connections",
				toolName: "mcp__ext__srv__list_connections",
				activityKind: "operation",
				status: "complete",
			},
			{
				kind: "narration",
				id: "message:assistant-2:0",
				turnId: "message:user-1",
				activityId: "message:assistant-2",
				text: "连接已就绪，继续执行。",
				status: "complete",
				timestamp: 3,
			},
			{
				kind: "tool",
				id: "tool:search-actions",
				turnId: "message:user-1",
				activityId: "message:assistant-2",
				toolCallId: "search-actions",
				toolName: "mcp__ext__srv__search_things",
				activityKind: "operation",
				status: "complete",
				summary: "pending records",
			},
			{
				kind: "tool",
				id: "tool:search-messages",
				turnId: "message:user-1",
				activityId: "message:assistant-3",
				toolCallId: "search-messages",
				toolName: "mcp__ext__srv__search_things",
				activityKind: "operation",
				status: "complete",
				summary: "messages",
			},
			{
				kind: "tool",
				id: "tool:search-list",
				turnId: "message:user-1",
				activityId: "message:assistant-3",
				toolCallId: "search-list",
				toolName: "mcp__ext__srv__search_things",
				activityKind: "operation",
				status: "complete",
				summary: "list",
			},
			{
				kind: "message",
				id: "message:assistant-final",
				role: "assistant",
				text: "查询完成。",
				status: "complete",
				timestamp: 4,
				stopReason: "stop",
			},
		];

		const rows = groupTranscriptItems(items);
		expect(rows).toHaveLength(3);
		expect(rows[1]).toMatchObject({ id: "work:message:user-1:message:assistant-1:0" });

		const markup = renderToStaticMarkup(createElement(TranscriptItems, { items, loading: false }));
		expect(markup).toContain("3 steps · 5 actions");
		const tools = items.filter(
			(item): item is Extract<DesktopTranscriptItem, { kind: "tool" }> => item.kind === "tool",
		);
		expect(workTimelineSteps(tools)).toMatchObject([
			{ verb: "Ran", chip: "2 actions" },
			{ verb: "Ran", chip: "pending records" },
			{ verb: "Ran", chip: "2 actions" },
		]);
		expect((markup.match(/data-slot="tool-timeline"/g) ?? []).length).toBe(1);
	});

	test("Connector 工具按投影下来的类别分层显示动词", () => {
		const tool = (
			id: string,
			toolName: string,
			activityKind: Extract<DesktopTranscriptItem, { kind: "tool" }>["activityKind"],
			summary?: string,
		): Extract<DesktopTranscriptItem, { kind: "tool" }> => ({
			kind: "tool",
			id: `tool:${id}`,
			turnId: "message:user-1",
			activityId: "message:assistant-1",
			toolCallId: id,
			toolName,
			activityKind,
			status: "complete",
			...(summary ? { summary } : {}),
		});

		const tools = [
			tool("list-apps", "connector__list_apps", "read", "apps"),
			tool("search-actions", "connector__search_actions", "search", "pending records"),
			// A read-only Action and a write Action split into separate steps even
			// though both are execute_action on the same activity.
			tool("read-mail", "connector__execute_action", "read", "google_gmail.list_messages"),
			tool("send-mail", "connector__execute_action", "write", "google_gmail.send_message"),
			// destructive has no dedicated verb yet and stays a generic operation.
			tool("purge", "connector__execute_action", "operation", "google_gmail.purge"),
		];

		expect(workTimelineSteps(tools)).toMatchObject([
			{ verb: "Read", chip: "apps" },
			{ verb: "Searched", chip: "pending records" },
			{ verb: "Read", chip: "google_gmail.list_messages" },
			{ verb: "Edited", chip: "google_gmail.send_message" },
			{ verb: "Ran", chip: "google_gmail.purge" },
		]);
	});

	test("回复文本仍然是工作阶段的顺序屏障", () => {
		const thinking: Extract<DesktopTranscriptItem, { kind: "thinking" }> = {
			kind: "thinking",
			id: "thinking:1",
			turnId: "turn-1",
			activityId: "message:assistant-1",
			text: "Analyze first",
			status: "complete",
			timestamp: 1,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply",
			role: "assistant",
			text: "先说说当前版本的分析，再动手。",
			status: "complete",
			timestamp: 2,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:1",
			turnId: "turn-1",
			activityId: "message:assistant-2",
			toolCallId: "call-1",
			toolName: "Bash",
			activityKind: "execute",
			status: "complete",
		};

		expect(groupTranscriptItems([thinking, reply, tool])).toEqual([
			{ id: "work:turn-1:thinking:1", items: [thinking] },
			reply,
			{ id: "work:turn-1:tool:1", items: [tool] },
		]);
	});
});
