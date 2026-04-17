import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@jayden/jai-ai";
import type { MessageEntry } from "@jayden/jai-session";
import { planCompactionCut } from "../src/core/session/agent-session.js";
import {
	findLastTurnStart,
	findSplitPointInLastTurn,
} from "../src/core/session/compaction.js";

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

function assistantToolCall(toolName: string, id = "tc"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "tool_call", toolCallId: id, toolName, input: {} }],
		stopReason: "tool_calls",
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		timestamp: 0,
	};
}

function toolResult(id = "tc"): ToolResultMessage {
	return {
		role: "tool_result",
		toolCallId: id,
		toolName: "Bash",
		content: [{ type: "text", text: "x" }],
		isError: false,
		timestamp: 0,
	};
}

function wrapEntries(msgs: Message[]): MessageEntry[] {
	return msgs.map((m, i) => ({
		type: "message" as const,
		id: `m${i}`,
		parentId: i === 0 ? "h0" : `m${i - 1}`,
		timestamp: i,
		message: m,
	}));
}

describe("findLastTurnStart", () => {
	test("returns the index of the last user message", () => {
		const msgs = [user("a"), assistantText("b"), user("c"), assistantText("d")];
		expect(findLastTurnStart(msgs)).toBe(2);
	});

	test("returns 0 when no user message is present (pathological)", () => {
		const msgs = [assistantText("a"), assistantText("b")];
		expect(findLastTurnStart(msgs)).toBe(0);
	});

	test("works when the last message is a user message", () => {
		const msgs = [user("a"), assistantText("b"), user("c")];
		expect(findLastTurnStart(msgs)).toBe(2);
	});
});

describe("findSplitPointInLastTurn", () => {
	test("returns null when suffix constraint cannot be satisfied", () => {
		const msgs = [user("q"), assistantToolCall("Bash"), toolResult(), assistantText("done")];
		expect(findSplitPointInLastTurn(msgs, 0)).toBeNull();
	});

	test("finds a valid cut at a user or assistant boundary, skipping tool_result suffix-start", () => {
		const msgs: Message[] = [
			user("q"),
			assistantToolCall("Bash", "a"),
			toolResult("a"),
			assistantToolCall("Bash", "b"),
			toolResult("b"),
			assistantToolCall("Bash", "c"),
			toolResult("c"),
			assistantText("p1"),
			assistantText("p2"),
			assistantText("p3"),
			assistantText("p4"),
		];
		const cut = findSplitPointInLastTurn(msgs, 0, 4);
		expect(cut).toBe(7);
	});

	test("rejects cuts that would orphan a tool_call (prev=assistant with tool_call)", () => {
		const msgs: Message[] = [
			user("q"),
			assistantText("a"),
			assistantToolCall("Bash"),
			toolResult(),
			assistantText("p1"),
			assistantText("p2"),
			assistantText("p3"),
			assistantText("p4"),
		];
		expect(findSplitPointInLastTurn(msgs, 0, 4)).toBe(4);

		const msgs2: Message[] = [
			user("q"),
			assistantText("a"),
			assistantText("b"),
			assistantText("c"),
			assistantToolCall("Bash"),
			toolResult(),
			assistantText("p1"),
			assistantText("p2"),
			assistantText("p3"),
			assistantText("p4"),
		];
		expect(findSplitPointInLastTurn(msgs2, 0, 4)).toBe(6);
	});

	test("single user + assistant pair: no valid interior cut", () => {
		const msgs: Message[] = [user("q"), assistantText("a")];
		expect(findSplitPointInLastTurn(msgs, 0)).toBeNull();
	});

	test("respects minSuffixCount — larger suffix shrinks search space", () => {
		const msgs: Message[] = [user("q")];
		for (let i = 0; i < 19; i++) msgs.push(assistantText(`t${i}`));
		expect(findSplitPointInLastTurn(msgs, 0, 8)).toBe(12);
	});
});

describe("planCompactionCut", () => {
	test("primary path: aligns forward to user boundary, no split", () => {
		const msgs: Message[] = [];
		for (let t = 0; t < 4; t++) {
			msgs.push(user(`q${t}`));
			msgs.push(assistantToolCall("Bash", `${t}a`));
			msgs.push(toolResult(`${t}a`));
			msgs.push(assistantToolCall("Bash", `${t}b`));
			msgs.push(toolResult(`${t}b`));
		}
		const entries = wrapEntries(msgs);

		const plan = planCompactionCut(entries);
		expect(plan).toEqual({ firstKeptIndex: 15, splitPoint: null });
	});

	test("returns null when too few messages", () => {
		const short: MessageEntry[] = [
			{ type: "message", id: "m0", parentId: "h", timestamp: 0, message: user("q") },
			{ type: "message", id: "m1", parentId: "m0", timestamp: 0, message: assistantText("a") },
		];
		expect(planCompactionCut(short)).toBeNull();
	});

	test("split-turn fallback: single huge last turn triggers mid-turn cut", () => {
		const msgs: Message[] = [
			user("q0"),
			assistantText("a0"),
			user("q1"),
			assistantText("a1"),
			user("big"),
		];
		for (let i = 0; i < 20; i++) {
			msgs.push(assistantToolCall("Bash", `big${i}`));
			msgs.push(toolResult(`big${i}`));
		}
		const entries = wrapEntries(msgs);

		const plan = planCompactionCut(entries);
		expect(plan).not.toBeNull();
		expect(plan!.splitPoint).toBe(4);
		expect(plan!.firstKeptIndex).toBeGreaterThan(4);
		expect(plan!.firstKeptIndex).toBeLessThan(msgs.length);
		expect(msgs[plan!.firstKeptIndex].role).not.toBe("tool_result");
	});

	test("split-turn fallback returns null when turnStart<2 (not enough history)", () => {
		const msgs: Message[] = [user("big")];
		for (let i = 0; i < 30; i++) {
			msgs.push(assistantToolCall("Bash", `b${i}`));
			msgs.push(toolResult(`b${i}`));
		}
		const entries = wrapEntries(msgs);
		const plan = planCompactionCut(entries);
		expect(plan).toBeNull();
	});
});
