import { describe, expect, test } from "bun:test";
import type { Message } from "@jayden/jai-ai";
import { isPromptTooLongError, truncateOldestByUserBoundary } from "../src/core/session/compaction.js";

// ── isPromptTooLongError ─────────────────────────────────────

describe("isPromptTooLongError", () => {
	test("matches anthropic-style 'prompt is too long'", () => {
		expect(isPromptTooLongError(new Error("prompt is too long: 500000 tokens > 200000 maximum"))).toBe(true);
	});

	test("matches OpenAI context_length_exceeded", () => {
		expect(
			isPromptTooLongError(new Error("This model's maximum context length is 8192 tokens, however...")),
		).toBe(true);
	});

	test("matches generic prompt_too_long code", () => {
		expect(isPromptTooLongError(new Error("API error: prompt_too_long"))).toBe(true);
	});

	test("walks down the cause chain", () => {
		const inner = new Error("prompt is too long");
		const outer = new Error("stream failed", { cause: inner });
		expect(isPromptTooLongError(outer)).toBe(true);
	});

	test("returns false for unrelated errors", () => {
		expect(isPromptTooLongError(new Error("network timeout"))).toBe(false);
		expect(isPromptTooLongError(new Error("rate limited"))).toBe(false);
		expect(isPromptTooLongError(null)).toBe(false);
		expect(isPromptTooLongError(undefined)).toBe(false);
	});
});

// ── truncateOldestByUserBoundary ─────────────────────────────

function u(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 } as Message;
}
function a(text: string): Message {
	return { role: "assistant", content: [{ type: "text", text }], stopReason: "end_turn", timestamp: 0 } as Message;
}

describe("truncateOldestByUserBoundary", () => {
	test("returns array as-is when too short", () => {
		const msgs = [u("1"), a("2")];
		expect(truncateOldestByUserBoundary(msgs)).toEqual(msgs);
	});

	test("drops oldest ~20% and aligns forward to user boundary", () => {
		const msgs = [
			u("u1"),
			a("a1"),
			u("u2"),
			a("a2"),
			u("u3"),
			a("a3"),
			u("u4"),
			a("a4"),
			u("u5"),
			a("a5"),
		];
		const out = truncateOldestByUserBoundary(msgs);
		// length=10 * 0.2 = 2 dropped initially; msgs[2] 已经是 user → 切在 idx=2
		expect(out.length).toBe(8);
		expect(out[0].role).toBe("user");
		expect((out[0] as any).content[0].text).toBe("u2");
	});

	test("scans past assistant until next user boundary", () => {
		const msgs = [u("u1"), a("a1"), a("a1b"), a("a1c"), a("a1d"), u("u2"), a("a2")];
		// initialDrop = floor(7*0.2) = 1 → idx=1 是 assistant → 向后扫到 idx=5（user）
		const out = truncateOldestByUserBoundary(msgs);
		expect(out[0].role).toBe("user");
		expect((out[0] as any).content[0].text).toBe("u2");
	});

	test("returns original when no user boundary after drop region", () => {
		const msgs = [u("u1"), a("a1"), a("a2"), a("a3"), a("a4")];
		// 只有开头一条 user，砍完后面全是 assistant，找不到 user boundary
		const out = truncateOldestByUserBoundary(msgs);
		expect(out.length).toBe(msgs.length);
	});
});
