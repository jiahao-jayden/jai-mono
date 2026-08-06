import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";
import {
	explorationSummary,
	groupTranscriptItems,
	TranscriptItem,
	workGroupTitle,
	workProcessRows,
} from "../src/components/shell/chat/chat-transcript";

describe("groupTranscriptItems", () => {
	test("只将明确的 compaction item 渲染为上下文压缩", () => {
		const compaction: DesktopTranscriptItem = {
			kind: "compaction",
			id: "compaction:1",
			summary: "Earlier context",
			timestamp: 1,
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

	test("按 turnId 合并相邻的思考与工具", () => {
		const items: DesktopTranscriptItem[] = [
			{
				kind: "thinking",
				id: "thinking:turn-1:0",
				turnId: "turn-1",
				text: "Inspecting the request",
				status: "complete",
				timestamp: 1,
			},
			{
				kind: "tool",
				id: "tool:skill-1",
				turnId: "turn-1",
				toolCallId: "skill-1",
				toolName: "Skill",
				status: "complete",
			},
			{
				kind: "thinking",
				id: "thinking:assistant-2:0",
				turnId: "turn-1",
				text: "Summarizing the tool result",
				status: "complete",
				timestamp: 2,
			},
		];

		expect(groupTranscriptItems(items)).toEqual([
			{
				id: "work:turn-1:thinking:turn-1:0",
				items,
			},
		]);
		const [row] = groupTranscriptItems(items);
		if (!row || "kind" in row) throw new Error("Expected a work group");
		expect(workGroupTitle(row.items, false)).toBe("Loading skill");
	});

	test("正文分隔工作阶段且不允许后续工具越过正文", () => {
		const thinking: Extract<DesktopTranscriptItem, { kind: "thinking" }> = {
			kind: "thinking",
			id: "thinking:1",
			turnId: "turn-1",
			text: "Analyze first",
			status: "complete",
			timestamp: 1,
		};
		const text: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:1:1",
			role: "assistant",
			text: "先说说当前版本的分析，再动手。",
			status: "complete",
			timestamp: 1,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:1",
			turnId: "turn-1",
			toolCallId: "call-1",
			toolName: "Bash",
			status: "complete",
		};
		const nextThinking: Extract<DesktopTranscriptItem, { kind: "thinking" }> = {
			...thinking,
			id: "thinking:2",
			text: "Continue after the tool",
			timestamp: 2,
		};

		expect(groupTranscriptItems([thinking, text, tool, nextThinking])).toEqual([
			{ id: "work:turn-1:thinking:1", items: [thinking] },
			text,
			{ id: "work:turn-1:tool:1", items: [tool, nextThinking] },
		]);
	});

	test("用实际工具生成语义标题", () => {
		const items: DesktopTranscriptItem[] = [
			{
				kind: "thinking",
				id: "thinking:turn-1:0",
				turnId: "turn-1",
				text: "Loading the research skill",
				status: "complete",
				timestamp: 1,
			},
			{
				kind: "tool",
				id: "tool:skill-1",
				turnId: "turn-1",
				toolCallId: "skill-1",
				toolName: "Skill",
				status: "complete",
				summary: "/last30days",
			},
		];

		const [row] = groupTranscriptItems(items);
		expect(row).not.toHaveProperty("kind");
		if (!row || "kind" in row) throw new Error("Expected a work group");
		expect(workGroupTitle(row.items, false)).toBe("Loaded last30days");
	});

	test("命令工具与未知工具使用稳定的阶段标题", () => {
		const bash: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:bash-1",
			turnId: "turn-1",
			toolCallId: "bash-1",
			toolName: "Bash",
			status: "running",
			summary: "date",
		};
		const unknown: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			...bash,
			id: "tool:custom-1",
			toolCallId: "custom-1",
			toolName: "InternalCustomTool",
			status: "complete",
		};

		expect(workGroupTitle([bash], true)).toBe("Executing");
		expect(workGroupTitle([{ ...bash, status: "complete" }], false)).toBe("Executing");
		expect(workGroupTitle([{ ...bash, status: "error" }], false)).toBe("Executing");
		expect(workGroupTitle([unknown], false)).toBe("Working");
	});

	test("连续读取和搜索聚合为一个探索步骤", () => {
		const read: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:read-1",
			turnId: "turn-1",
			toolCallId: "read-1",
			toolName: "Read",
			status: "complete",
			summary: "README.md",
		};
		const grep: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			...read,
			id: "tool:grep-1",
			toolCallId: "grep-1",
			toolName: "Grep",
			summary: "src",
		};

		const rows = workProcessRows([read, grep]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "exploration", items: [read, grep] });
		expect(explorationSummary([read, grep], false, false)).toBe("Explored 1 file, 1 search");
		expect(workGroupTitle([read, grep], false)).toBe("Exploring");
	});
});
