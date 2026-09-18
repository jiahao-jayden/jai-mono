import { describe, expect, test } from "bun:test";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";
import { groupTranscriptItems } from "../src/components/shell/chat/chat-transcript";
import {
	computeDockTickStyles,
	computeFocusedTrailIndex,
	computeTrailGeometry,
	createActiveTrailStore,
	deriveMessageTrailAnchors,
	deriveMessageTrailItems,
	emptyActiveTrailSnapshot,
	resolveActiveTrailSnapshot,
} from "../src/components/shell/chat/message-trail-logic";

const messages: DesktopTranscriptItem[] = [
	{ kind: "message", id: "user-1", role: "user", text: " first\n prompt ", status: "complete", timestamp: 1 },
	{ kind: "message", id: "assistant-1", role: "assistant", text: "opening", status: "complete", timestamp: 2 },
	{ kind: "message", id: "assistant-2", role: "assistant", text: "final reply", status: "complete", timestamp: 3 },
	{ kind: "thinking", id: "thinking-1", turnId: "turn-1", activityId: "work-1", text: "", status: "complete", timestamp: 4 },
	{ kind: "message", id: "user-2", role: "user", text: "second", status: "complete", timestamp: 5 },
];

describe("message trail logic", () => {
	test("将转录投影为每轮一个 prompt，并选择最后一条非空 assistant 回复", () => {
		const items = deriveMessageTrailItems(messages);

		expect(items).toEqual([
			{ id: "user-1", ordinal: 1, promptPreview: "first prompt", assistantPreview: "final reply" },
			{ id: "user-2", ordinal: 2, promptPreview: "second", assistantPreview: "" },
		]);
	});

	test("截断预览并从分组后的真实行导出锚点", () => {
		const longText = "x".repeat(281);
		const rows = groupTranscriptItems([
			...messages,
			{ kind: "message", id: "user-3", role: "user", text: longText, status: "complete", timestamp: 6 },
		]);

		expect(deriveMessageTrailItems(rows.filter((row): row is DesktopTranscriptItem => "kind" in row))).toHaveLength(3);
		expect(deriveMessageTrailItems([{ kind: "message", id: "long", role: "user", text: longText, status: "complete", timestamp: 7 }])[0]?.promptPreview).toBe(
			`${"x".repeat(280)}…`,
		);
		expect(deriveMessageTrailAnchors(rows)).toEqual([
			{ id: "user-1", rowIndex: 0 },
			{ id: "user-2", rowIndex: 4 },
			{ id: "user-3", rowIndex: 5 },
		]);
	});

	test("解析当前与可见锚点，且相等快照不通知订阅者", () => {
		const anchors = [
			{ id: "user-1", rowIndex: 0 },
			{ id: "user-2", rowIndex: 4 },
			{ id: "user-3", rowIndex: 5 },
		];
		const snapshot = resolveActiveTrailSnapshot(anchors, 4, 5);
		const store = createActiveTrailStore();
		let updates = 0;
		const unsubscribe = store.subscribe(() => {
			updates += 1;
		});

		expect(snapshot).toEqual({ currentId: "user-2", visibleIds: ["user-2", "user-3"] });
		store.setSnapshot(snapshot);
		store.setSnapshot({ currentId: "user-2", visibleIds: ["user-2", "user-3"] });
		store.setSnapshot(null);
		unsubscribe();
		expect(updates).toBe(2);
		expect(store.getSnapshot()).toBe(emptyActiveTrailSnapshot);
	});

	test("按 Dock 高斯衰减计算 tick 几何", () => {
		const geometry = computeTrailGeometry(3);
		expect(geometry).toEqual({ spacing: 10, centerYs: [12, 22, 32], contentHeight: 44 });
		expect(computeFocusedTrailIndex(27, geometry!)).toBe(2);

		const styles = computeDockTickStyles(geometry!, 22, 1, new Set([0]));
		expect(styles[1]).toEqual({ width: 30, opacity: 1 });
		expect(styles[0]?.width).toBeGreaterThan(6);
		expect(styles[2]?.opacity).toBe(0.2);
	});
});
