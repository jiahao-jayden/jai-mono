import { describe, expect, test } from "bun:test";
import { zeroUsage, type AssistantMessage, type Usage } from "@jai/ai";
import { estimateContextTokens, estimateTokens, resolveCompactionSettings, shouldCompact } from "../../../src/harness";
import type { AgentContext, AgentMessage } from "../../../src";
import { compactionEntry, messageEntry, model } from "../../support/fixtures";
import type { SessionEntry } from "../../../src/harness";

const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 0 });

function usageOf(totalTokens: number): Usage {
	return { ...zeroUsage(), input: totalTokens, totalTokens };
}

function reply(totalTokens: number, stopReason: AssistantMessage["stopReason"] = "stop"): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		provider: "test",
		model: model.id,
		usage: usageOf(totalTokens),
		stopReason,
		timestamp: 0,
	};
}

const contextOf = (messages: AgentMessage[], systemPrompt = ""): AgentContext => ({
	systemPrompt,
	messages,
	tools: [],
});

describe("estimateTokens", () => {
	test("counts roughly four characters per token", () => {
		const tokens = estimateTokens(user("a".repeat(4_000)));

		expect(tokens).toBeGreaterThanOrEqual(1_000);
		expect(tokens).toBeLessThan(1_020);
	});

	test("charges a flat placeholder for images instead of their base64 payload", () => {
		const withImage: AgentMessage = {
			role: "user",
			content: [{ type: "image", image: "x".repeat(50_000), mimeType: "image/png" }],
			timestamp: 0,
		};

		const tokens = estimateTokens(withImage);

		expect(tokens).toBeGreaterThan(500);
		expect(tokens).toBeLessThan(2_000);
	});

	test("a context costs its system prompt, tools and messages", () => {
		const messages = [user("a".repeat(400))];
		const bare = estimateTokens(contextOf(messages));
		const withPrompt = estimateTokens(contextOf(messages, "b".repeat(400)));

		expect(withPrompt).toBeGreaterThan(bare);
	});
});

describe("estimateContextTokens", () => {
	test("uses the provider baseline plus the messages appended after it", () => {
		const estimate = estimateContextTokens(contextOf([user("hi"), reply(5_000), user("a".repeat(4_000))]));

		expect(estimate.usageBaselineValid).toBe(true);
		expect(estimate.usageTokens).toBe(5_000);
		expect(estimate.lastUsageIndex).toBe(1);
		expect(estimate.trailingTokens).toBeGreaterThanOrEqual(1_000);
		expect(estimate.tokens).toBe(estimate.usageTokens + estimate.trailingTokens);
	});

	test("falls back to a full estimate when no usage is reported", () => {
		const estimate = estimateContextTokens(contextOf([user("a".repeat(4_000))]));

		expect(estimate.usageBaselineValid).toBe(false);
		expect(estimate.lastUsageIndex).toBeNull();
		expect(estimate.tokens).toBe(estimate.fullEstimateTokens);
	});

	test("never reports less than the full estimate, so a grown prompt still counts", () => {
		const estimate = estimateContextTokens(contextOf([user("a".repeat(40_000)), reply(10)]));

		expect(estimate.usageBaselineValid).toBe(true);
		expect(estimate.tokens).toBe(estimate.fullEstimateTokens);
	});

	test("ignores usage from failed or aborted responses", () => {
		for (const stopReason of ["error", "aborted"] as const) {
			expect(estimateContextTokens(contextOf([reply(5_000, stopReason)])).usageBaselineValid).toBe(false);
		}
	});

	test("keeps usage from a truncated response, which is exactly when compaction is due", () => {
		expect(estimateContextTokens(contextOf([reply(5_000, "contextOverflow")])).usageBaselineValid).toBe(true);
	});

	test("invalidates the baseline when a compaction was logged after the last usage", () => {
		const entries: SessionEntry[] = [
			messageEntry("e0", "hi"),
			{ type: "message", id: "e1", timestamp: "e1", message: reply(5_000) },
			compactionEntry("e2", "summary", "e1"),
		];

		const estimate = estimateContextTokens(contextOf([user("hi"), reply(5_000)]), entries);

		expect(estimate.usageBaselineValid).toBe(false);
		expect(estimate.tokens).toBe(estimate.fullEstimateTokens);
	});
});

describe("resolveCompactionSettings", () => {
	test("reserves the output budget plus a safety margin", () => {
		const settings = resolveCompactionSettings({ ...model, contextWindow: 200_000, maxTokens: 8_000 });

		expect(settings.reserveTokens).toBe(12_096);
		expect(settings.tailTurns).toBe(2);
		expect(settings.preserveRecentTokens).toBe(8_000);
	});

	test("clamps the reserve for tiny and huge output budgets", () => {
		expect(resolveCompactionSettings({ ...model, contextWindow: 200_000, maxTokens: 100 }).reserveTokens).toBe(8_192);
		expect(resolveCompactionSettings({ ...model, contextWindow: 500_000, maxTokens: 64_000 }).reserveTokens).toBe(
			20_000,
		);
	});

	test("never preserves more tail than the usable context", () => {
		const settings = resolveCompactionSettings({ ...model, contextWindow: 9_000, maxTokens: 500 });

		expect(settings.preserveRecentTokens).toBeLessThanOrEqual(9_000 - settings.reserveTokens);
	});

	test("overrides win", () => {
		expect(
			resolveCompactionSettings(model, { reserveTokens: 3_000, tailTurns: 5, preserveRecentTokens: 1_000 }),
		).toEqual({ reserveTokens: 3_000, tailTurns: 5, preserveRecentTokens: 1_000 });
	});

	test("rejects nonsense up front instead of at the first model call", () => {
		const cases: Parameters<typeof resolveCompactionSettings>[1][] = [
			{ reserveTokens: Number.NaN },
			{ reserveTokens: -1 },
			{ tailTurns: 1.5 },
			{ reserveTokens: model.contextWindow },
			{ reserveTokens: 5_000, preserveRecentTokens: 5_001 },
		];

		for (const overrides of cases) {
			expect(() => resolveCompactionSettings(model, overrides)).toThrow();
		}
	});
});

describe("shouldCompact", () => {
	const settings = { reserveTokens: 2_000, tailTurns: 2, preserveRecentTokens: 1_000 };

	test("triggers strictly above the usable context", () => {
		expect(shouldCompact(8_000, model, settings)).toBe(false);
		expect(shouldCompact(8_001, model, settings)).toBe(true);
	});
});
