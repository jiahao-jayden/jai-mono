import { describe, expect, test } from "bun:test";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";
import { groupTranscriptItems, workGroupTitle } from "../src/components/shell/chat/chat-transcript";

describe("groupTranscriptItems", () => {
	test("按 turnId 合并乱序到达的进度、思考与工具", () => {
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
				kind: "progress",
				id: "progress:progress-1",
				turnId: "turn-1",
				title: "检查运行环境",
				detail: "读取技能并确认下一步。",
				timestamp: 1,
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
				id: "work:turn-1",
				items,
			},
		]);
	});

	test("缺少 ReportProgress 时用实际工具生成语义标题", () => {
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
});
