import { describe, expect, test } from "bun:test";
import { zeroUsage } from "@jai/ai";
import {
	findCompactionCut,
	projectCompactedMessages,
	type CompactionSettings,
	type SessionEntry,
} from "../../../src/harness";
import { model } from "../../support/fixtures";

const settings: CompactionSettings = { reserveTokens: 1_000, tailTurns: 2, preserveRecentTokens: 200 };

/** 一条 user message entry，text 长度决定它的估算体积。 */
function u(id: string, text: string): SessionEntry {
	return { type: "message", id, parentId: null, timestamp: id, message: { role: "user", content: text, timestamp: 0 } };
}

function a(id: string, text: string, toolCallIds: string[] = []): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: id,
		message: {
			role: "assistant",
			content: [
				{ type: "text", text },
				...toolCallIds.map((callId) => ({ type: "toolCall" as const, id: callId, name: "read", arguments: {} })),
			],
			provider: "test",
			model: model.id,
			usage: zeroUsage(),
			stopReason: toolCallIds.length > 0 ? ("toolUse" as const) : ("stop" as const),
			timestamp: 0,
		},
	};
}

function r(id: string, toolCallId: string, text: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: id,
		message: {
			role: "toolResult",
			toolCallId,
			toolName: "read",
			content: [{ type: "text", text }],
			isError: false,
			timestamp: 0,
		},
	};
}

function compaction(id: string, summary: string, firstKeptEntryId: string): SessionEntry {
	return {
		type: "compaction",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		summary,
		firstKeptEntryId,
		tokensBefore: 1_000,
		tokensAfter: 100,
		usage: zeroUsage(),
	};
}

const text = (message: { content: unknown }): string =>
	typeof message.content === "string" ? message.content : JSON.stringify(message.content);

describe("projectCompactedMessages", () => {
	test("returns every message untouched when nothing was compacted", () => {
		const entries = [u("e0", "one"), a("e1", "two"), { ...u("e2", "three") }];

		expect(projectCompactedMessages(entries)).toHaveLength(3);
	});

	test("replaces the compacted head with a summary and keeps the tail plus later messages", () => {
		const entries = [u("e0", "old"), a("e1", "older reply"), a("e2", "kept reply"), compaction("e3", "S", "e2"), u("e4", "new")];

		const messages = projectCompactedMessages(entries);

		expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
		expect(text(messages[0]!)).toContain("<summary>\nS\n</summary>");
		expect(text(messages[1]!)).toContain("kept reply");
		expect(text(messages[2]!)).toBe("new");
	});

	test("merges the summary into the retained tail instead of emitting two user messages in a row", () => {
		const entries = [u("e0", "old"), u("e1", "kept question"), compaction("e2", "S", "e1")];

		const messages = projectCompactedMessages(entries);

		expect(messages.map((message) => message.role)).toEqual(["user"]);
		expect(text(messages[0]!)).toContain("<summary>\nS\n</summary>");
		expect(text(messages[0]!)).toContain("kept question");
	});

	test("only the latest compaction is applied", () => {
		const entries = [
			u("e0", "a"),
			u("e1", "b"),
			compaction("e2", "first summary", "e1"),
			a("e3", "reply"),
			compaction("e4", "second summary", "e3"),
		];

		const messages = projectCompactedMessages(entries);

		expect(messages).toHaveLength(2);
		expect(text(messages[0]!)).toContain("second summary");
		expect(text(messages[0]!)).not.toContain("first summary");
	});

	test("app_state entries never reach the model", () => {
		const entries: SessionEntry[] = [u("e0", "hi"), { type: "app_state", id: "e1", parentId: null, timestamp: "e1", value: {} }];

		expect(projectCompactedMessages(entries)).toHaveLength(1);
	});
});

describe("findCompactionCut", () => {
	test("keeps recent turns within budget and summarizes the rest", () => {
		const entries = [u("e0", "x".repeat(4_000)), a("e1", "old reply"), u("e2", "recent"), a("e3", "recent reply")];

		const cut = findCompactionCut(entries, settings);

		expect(cut?.firstKeptEntryId).toBe("e2");
		expect(cut?.messagesToSummarize).toHaveLength(2);
		expect(cut?.messagesToKeep).toHaveLength(2);
	});

	test("returns undefined when there is nothing new to summarize", () => {
		expect(findCompactionCut([u("e0", "only turn")], settings)).toBeUndefined();
	});

	test("never starts the retained tail at a tool result", () => {
		const entries = [
			u("e0", "x".repeat(4_000)),
			u("e1", "second"),
			a("e2", "calling", ["call-1"]),
			r("e3", "call-1", "y".repeat(4_000)),
			a("e4", "done"),
		];

		const cut = findCompactionCut(entries, settings);

		expect(cut?.messagesToKeep[0]?.role).not.toBe("toolResult");
		expect(cut?.firstKeptEntryId).not.toBe("e3");
	});

	test("falls back to the smallest protocol-safe tail when nothing fits the budget", () => {
		const entries = [
			u("e0", "x".repeat(4_000)),
			u("e1", "y".repeat(4_000)),
			a("e2", "calling", ["call-1"]),
			r("e3", "call-1", "z".repeat(4_000)),
		];

		const cut = findCompactionCut(entries, settings);

		expect(cut?.firstKeptEntryId).toBe("e2");
		expect(cut?.messagesToKeep.map((message) => message.role)).toEqual(["assistant", "toolResult"]);
	});

	test("only summarizes history added after the previous compaction", () => {
		const entries = [
			u("e0", "ancient"),
			u("e1", "x".repeat(4_000)),
			compaction("e2", "previous", "e1"),
			u("e3", "x".repeat(4_000)),
			u("e4", "recent"),
		];

		const cut = findCompactionCut(entries, settings);

		expect(cut?.firstKeptEntryId).toBe("e4");
		expect(cut?.messagesToSummarize).toHaveLength(2);
		expect(cut?.messagesToSummarize.every((message) => message.content !== "ancient")).toBe(true);
	});
});
