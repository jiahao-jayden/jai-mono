import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@jayden/jai-ai";
import {
	collectRecentFileReadPaths,
	COMPACT_BUFFER_TOKENS,
	formatCompactSummary,
	microcompact,
	RESERVED_OUTPUT_TOKENS,
	shouldCompact,
	__internal,
} from "../src/core/session/compaction.js";

const { getCompactThreshold, getEffectiveContextWindow, stripMediaFromMessages } = __internal;

// ── Fixture helpers ──────────────────────────────────────────

function user(text: string): UserMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

function assistantText(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		timestamp: 0,
	};
}

function assistantToolCall(toolName: string, input: unknown, id = "tc1"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "tool_call", toolCallId: id, toolName, input }],
		stopReason: "tool_calls",
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		timestamp: 0,
	};
}

function toolResult(toolName: string, text: string, id = "tc1"): ToolResultMessage {
	return {
		role: "tool_result",
		toolCallId: id,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: 0,
	};
}

// ── shouldCompact / windows ──────────────────────────────────

describe("shouldCompact / threshold math", () => {
	const LIMIT = 200_000;

	test("effective window subtracts reserved summary output", () => {
		expect(getEffectiveContextWindow(LIMIT)).toBe(LIMIT - RESERVED_OUTPUT_TOKENS);
	});

	test("compact threshold subtracts buffer on top of effective window", () => {
		expect(getCompactThreshold(LIMIT)).toBe(LIMIT - RESERVED_OUTPUT_TOKENS - COMPACT_BUFFER_TOKENS);
	});

	test("returns false at boundary (threshold itself)", () => {
		const threshold = getCompactThreshold(LIMIT);
		expect(shouldCompact(threshold, LIMIT)).toBe(false);
	});

	test("returns false 1 token below threshold", () => {
		const threshold = getCompactThreshold(LIMIT);
		expect(shouldCompact(threshold - 1, LIMIT)).toBe(false);
	});

	test("returns true 1 token above threshold", () => {
		const threshold = getCompactThreshold(LIMIT);
		expect(shouldCompact(threshold + 1, LIMIT)).toBe(true);
	});
});

// ── stripMediaFromMessages ───────────────────────────────────

describe("stripMediaFromMessages", () => {
	test("replaces UserMessage ImageContent with [image]", () => {
		const msg: UserMessage = {
			role: "user",
			content: [
				{ type: "text", text: "hi" },
				{ type: "image", data: "xxx", mimeType: "image/png" },
			],
			timestamp: 0,
		};
		const [out] = stripMediaFromMessages([msg]) as [UserMessage];
		expect(out.content).toEqual([
			{ type: "text", text: "hi" },
			{ type: "text", text: "[image]" },
		]);
	});

	test("replaces UserMessage FileContent with [file: name]", () => {
		const msg: UserMessage = {
			role: "user",
			content: [
				{ type: "file", data: "xxx", mimeType: "application/pdf", filename: "spec.pdf" },
			],
			timestamp: 0,
		};
		const [out] = stripMediaFromMessages([msg]) as [UserMessage];
		expect(out.content).toEqual([{ type: "text", text: "[file: spec.pdf]" }]);
	});

	test("replaces FileContent without filename with [file]", () => {
		const msg: UserMessage = {
			role: "user",
			content: [{ type: "file", data: "xxx", mimeType: "application/pdf" }],
			timestamp: 0,
		};
		const [out] = stripMediaFromMessages([msg]) as [UserMessage];
		expect(out.content).toEqual([{ type: "text", text: "[file]" }]);
	});

	test("replaces ImageContent nested inside ToolResultMessage", () => {
		const msg: ToolResultMessage = {
			role: "tool_result",
			toolCallId: "tc1",
			toolName: "FileRead",
			content: [
				{ type: "text", text: "screenshot:" },
				{ type: "image", data: "xxx", mimeType: "image/png" },
			],
			isError: false,
			timestamp: 0,
		};
		const [out] = stripMediaFromMessages([msg]) as [ToolResultMessage];
		expect(out.content).toEqual([
			{ type: "text", text: "screenshot:" },
			{ type: "text", text: "[image]" },
		]);
	});

	test("assistant messages pass through unchanged by reference", () => {
		const a = assistantText("hello");
		const [out] = stripMediaFromMessages([a]);
		expect(out).toBe(a);
	});

	test("user message without media returned by reference (no clone)", () => {
		const u = user("hi");
		const [out] = stripMediaFromMessages([u]);
		expect(out).toBe(u);
	});
});

// ── microcompact ─────────────────────────────────────────────

describe("microcompact", () => {
	const CONTEXT_LIMIT = 200_000;
	const BELOW_THRESHOLD = CONTEXT_LIMIT * (__internal.MICROCOMPACT_THRESHOLD - 0.01);
	const ABOVE_THRESHOLD = CONTEXT_LIMIT * (__internal.MICROCOMPACT_THRESHOLD + 0.01);

	test("returns input unchanged below threshold", () => {
		const msgs: Message[] = [
			user("q"),
			assistantToolCall("FileRead", { path: "a.ts" }),
			toolResult("FileRead", "file body here"),
			assistantText("done"),
		];
		const out = microcompact({
			messages: msgs,
			lastInputTokens: BELOW_THRESHOLD,
			contextLimit: CONTEXT_LIMIT,
		});
		expect(out).toBe(msgs);
	});

	test("above threshold: keeps last N turns intact, clears older whitelisted tool results", () => {
		// 6 turns total, keepRecentTurns=4 default → clear first 2 turns' tool_results
		const build = (i: number): Message[] => [
			user(`q${i}`),
			assistantToolCall("FileRead", { path: `f${i}.ts` }, `tc${i}`),
			toolResult("FileRead", `body${i}`, `tc${i}`),
		];
		const msgs: Message[] = [];
		for (let i = 0; i < 6; i++) msgs.push(...build(i));

		const out = microcompact({
			messages: msgs,
			lastInputTokens: ABOVE_THRESHOLD,
			contextLimit: CONTEXT_LIMIT,
		});

		// tc0, tc1 should be cleared; tc2..tc5 preserved
		const results = out.filter((m): m is ToolResultMessage => m.role === "tool_result");
		expect(results.length).toBe(6);
		expect((results[0].content[0] as { text: string }).text).toBe(__internal.CLEARED_PLACEHOLDER);
		expect((results[1].content[0] as { text: string }).text).toBe(__internal.CLEARED_PLACEHOLDER);
		expect((results[2].content[0] as { text: string }).text).toBe("body2");
		expect((results[5].content[0] as { text: string }).text).toBe("body5");
	});

	test("does not compact non-whitelisted tools", () => {
		const msgs: Message[] = [];
		for (let i = 0; i < 6; i++) {
			msgs.push(user(`q${i}`), assistantToolCall("CustomTool", {}, `tc${i}`), toolResult("CustomTool", `x${i}`, `tc${i}`));
		}
		const out = microcompact({
			messages: msgs,
			lastInputTokens: ABOVE_THRESHOLD,
			contextLimit: CONTEXT_LIMIT,
		});
		const results = out.filter((m): m is ToolResultMessage => m.role === "tool_result");
		for (const r of results) {
			expect((r.content[0] as { text: string }).text).not.toBe(__internal.CLEARED_PLACEHOLDER);
		}
	});

	test("idempotent: already-cleared placeholder stays unchanged", () => {
		const msgs: Message[] = [];
		for (let i = 0; i < 6; i++) {
			msgs.push(user(`q${i}`), assistantToolCall("FileRead", { path: `f${i}` }, `tc${i}`), toolResult("FileRead", `b${i}`, `tc${i}`));
		}
		const first = microcompact({
			messages: msgs,
			lastInputTokens: ABOVE_THRESHOLD,
			contextLimit: CONTEXT_LIMIT,
		});
		const second = microcompact({
			messages: first,
			lastInputTokens: ABOVE_THRESHOLD,
			contextLimit: CONTEXT_LIMIT,
		});
		const r1 = first.filter((m): m is ToolResultMessage => m.role === "tool_result");
		const r2 = second.filter((m): m is ToolResultMessage => m.role === "tool_result");
		for (let i = 0; i < 2; i++) {
			expect(r2[i]).toBe(r1[i]); // same reference since already cleared
		}
	});
});

// ── formatCompactSummary ─────────────────────────────────────

describe("formatCompactSummary", () => {
	test("strips <analysis> and extracts <summary> with prefix", () => {
		const raw =
			"<analysis>thinking...</analysis>\n<summary>1. Foo\n2. Bar</summary>";
		const out = formatCompactSummary(raw);
		expect(out).toBe("Summary:\n1. Foo\n2. Bar");
	});

	test("works with only <summary>, no <analysis>", () => {
		const raw = "<summary>just this</summary>";
		expect(formatCompactSummary(raw)).toBe("Summary:\njust this");
	});

	test("works with only <analysis>, no <summary> — analysis is still stripped", () => {
		const raw = "<analysis>scratch</analysis>\n\npost-text";
		expect(formatCompactSummary(raw)).toBe("post-text");
	});

	test("returns trimmed input when no tags present", () => {
		expect(formatCompactSummary("  plain summary  ")).toBe("plain summary");
	});

	test("collapses 3+ consecutive newlines to 2", () => {
		expect(formatCompactSummary("a\n\n\n\nb")).toBe("a\n\nb");
	});
});

// ── collectRecentFileReadPaths ───────────────────────────────

describe("collectRecentFileReadPaths", () => {
	test("extracts deduplicated FileRead paths in last-occurrence order", () => {
		const msgs: Message[] = [
			assistantToolCall("FileRead", { path: "a.ts" }, "t1"),
			toolResult("FileRead", "x", "t1"),
			assistantToolCall("FileRead", { path: "b.ts" }, "t2"),
			toolResult("FileRead", "x", "t2"),
			assistantToolCall("FileRead", { path: "a.ts" }, "t3"), // revisit a.ts
			toolResult("FileRead", "x", "t3"),
			assistantToolCall("FileRead", { path: "c.ts" }, "t4"),
			toolResult("FileRead", "x", "t4"),
		];
		// Order after de-dup (last-occurrence wins): b, a, c
		expect(collectRecentFileReadPaths(msgs)).toEqual(["b.ts", "a.ts", "c.ts"]);
	});

	test("ignores non-FileRead tool calls", () => {
		const msgs: Message[] = [
			assistantToolCall("Bash", { command: "ls" }, "t1"),
			assistantToolCall("FileRead", { path: "a.ts" }, "t2"),
		];
		expect(collectRecentFileReadPaths(msgs)).toEqual(["a.ts"]);
	});

	test("limits to last N paths", () => {
		const msgs: Message[] = [];
		for (let i = 0; i < 15; i++) {
			msgs.push(assistantToolCall("FileRead", { path: `f${i}.ts` }, `t${i}`));
		}
		const out = collectRecentFileReadPaths(msgs, 5);
		expect(out).toEqual(["f10.ts", "f11.ts", "f12.ts", "f13.ts", "f14.ts"]);
	});

	test("returns empty array when no FileRead calls present", () => {
		const msgs: Message[] = [user("hi"), assistantText("ok")];
		expect(collectRecentFileReadPaths(msgs)).toEqual([]);
	});

	test("ignores FileRead calls with missing or non-string path", () => {
		const msgs: Message[] = [
			assistantToolCall("FileRead", {}, "t1"),
			assistantToolCall("FileRead", { path: 123 }, "t2"),
			assistantToolCall("FileRead", { path: "ok.ts" }, "t3"),
		];
		expect(collectRecentFileReadPaths(msgs)).toEqual(["ok.ts"]);
	});
});
