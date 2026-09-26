import { describe, expect, test } from "bun:test";
import {
	normalizeRuntimeModelCatalog,
	resolveEffectiveReasoningLevel,
	resolveRuntimeModelCapabilities,
} from "../../src/model-catalog";

const catalog = normalizeRuntimeModelCatalog({ providers: {
	anthropic: {
		name: "Anthropic",
		models: {
			"claude-effort": {
				reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
				experimental: {
					modes: {
						fast: {
							provider: { body: { speed: "fast" }, headers: { "anthropic-beta": "fast-mode-2026-02-01" } },
						},
					},
				},
			},
			"claude-budget": { reasoning_options: [{ type: "budget_tokens", min: 1024 }] },
			"claude-toggle": { reasoning_options: [{ type: "toggle" }] },
		},
	},
	openai: {
		name: "OpenAI",
		models: {
			"gpt-full": {
				reasoning_options: [{ type: "effort", values: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] }],
				experimental: { modes: { fast: { provider: { body: { service_tier: "priority" } } } } },
			},
			"gpt-odd-fast": { experimental: { modes: { fast: { provider: { body: { tier: "turbo" } } } } } },
		},
	},
} });
const model = (provider: string, id: string) => catalog.providers[provider]?.models[id];

describe("model capabilities", () => {
	test("keeps only the levels the adapter can express and Fast mode in the adapter's own protocol", () => {
		expect(resolveRuntimeModelCapabilities(model("anthropic", "claude-effort"), "anthropic")).toEqual({
			reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
			supportsFastMode: true,
		});
		expect(resolveRuntimeModelCapabilities(model("openai", "gpt-full"), "anthropic")).toEqual({
			reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
			supportsFastMode: false,
		});
		expect(resolveRuntimeModelCapabilities(model("openai", "gpt-full"), "openai-responses")).toEqual({
			reasoningLevels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
			supportsFastMode: true,
		});
		expect(resolveRuntimeModelCapabilities(model("anthropic", "claude-effort"), "openai-compatible").supportsFastMode).toBe(
			false,
		);
	});

	test("offers nothing for missing entries, toggle or budget-only declarations and unknown Fast mode bodies", () => {
		const none = { reasoningLevels: [], supportsFastMode: false };
		expect(resolveRuntimeModelCapabilities(undefined, "anthropic")).toEqual(none);
		expect(resolveRuntimeModelCapabilities(model("anthropic", "claude-effort"), undefined)).toEqual(none);
		expect(resolveRuntimeModelCapabilities(model("anthropic", "claude-budget"), "anthropic")).toEqual(none);
		expect(resolveRuntimeModelCapabilities(model("anthropic", "claude-toggle"), "anthropic")).toEqual(none);
		expect(model("openai", "gpt-odd-fast")?.fastMode).toBeUndefined();
		expect(resolveRuntimeModelCapabilities(model("openai", "gpt-odd-fast"), "openai-compatible")).toEqual(none);
	});

	test("resolves the desired level downwards only", () => {
		const supported = ["low", "medium", "high"] as const;
		expect(resolveEffectiveReasoningLevel("max", supported)).toBe("high");
		expect(resolveEffectiveReasoningLevel("medium", supported)).toBe("medium");
		expect(resolveEffectiveReasoningLevel("minimal", supported)).toBeUndefined();
		expect(resolveEffectiveReasoningLevel("low", ["high", "xhigh"])).toBeUndefined();
		expect(resolveEffectiveReasoningLevel("high", [])).toBeUndefined();
		expect(resolveEffectiveReasoningLevel(undefined, supported)).toBeUndefined();
	});
});
