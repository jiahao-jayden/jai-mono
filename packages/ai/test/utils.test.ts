import { describe, expect, test } from "bun:test";
import { resolveModelInfo } from "../src/models.js";
import type { ResolvedModel } from "../src/types.js";
import { ProviderTransform } from "../src/utils.js";

// ── helpers ──────────────────────────────────────────────────

function makeModel(overrides: Partial<ResolvedModel> = {}): ResolvedModel {
	return {
		id: "anthropic/claude-sonnet-4-20250514",
		providerId: "anthropic",
		npm: "@ai-sdk/anthropic",
		apiModelId: "claude-sonnet-4-20250514",
		family: "claude-sonnet",
		releaseDate: "2025-05-14",
		config: {
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
		},
		capabilities: {
			reasoning: true,
			toolCall: true,
			structuredOutput: false,
			input: { text: true, image: true, audio: false, video: false, pdf: true },
			output: { text: true, image: false },
		},
		limit: { context: 200000, output: 64000 },
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		...overrides,
	};
}

function makeOpenAIModel(
	overrides: Partial<ResolvedModel> = {},
): ResolvedModel {
	return makeModel({
		id: "openai/gpt-4o",
		providerId: "openai",
		npm: "@ai-sdk/openai",
		apiModelId: "gpt-4o",
		family: "gpt",
		releaseDate: "2024-05-13",
		config: { provider: "openai", model: "gpt-4o" },
		capabilities: {
			reasoning: false,
			toolCall: true,
			structuredOutput: true,
			input: { text: true, image: true, audio: false, video: false, pdf: false },
			output: { text: true, image: false },
		},
		limit: { context: 128000, output: 16384 },
		cost: { input: 2.5, output: 10, cacheRead: 1.25 },
		...overrides,
	});
}

function makeGoogleModel(
	overrides: Partial<ResolvedModel> = {},
): ResolvedModel {
	return makeModel({
		id: "google/gemini-2.5-pro",
		providerId: "google",
		npm: "@ai-sdk/google",
		apiModelId: "gemini-2.5-pro",
		family: "gemini",
		config: { provider: "google", model: "gemini-2.5-pro" },
		capabilities: {
			reasoning: true,
			toolCall: true,
			structuredOutput: true,
			input: { text: true, image: true, audio: true, video: true, pdf: true },
			output: { text: true, image: true },
		},
		limit: { context: 1048576, output: 65536 },
		...overrides,
	});
}

// ── temperature ──────────────────────────────────────────────

describe("ProviderTransform.temperature", () => {
	test("claude models return undefined", () => {
		expect(ProviderTransform.temperature(makeModel())).toBeUndefined();
	});

	test("gemini models return 1.0", () => {
		expect(ProviderTransform.temperature(makeGoogleModel())).toBe(1.0);
	});

	test("qwen models return 0.55", () => {
		const m = makeModel({
			id: "alibaba-cn/qwen-plus",
			apiModelId: "qwen-plus",
		});
		expect(ProviderTransform.temperature(m)).toBe(0.55);
	});

	test("kimi-k2 returns 0.6", () => {
		const m = makeModel({
			id: "moonshot/kimi-k2",
			apiModelId: "kimi-k2",
		});
		expect(ProviderTransform.temperature(m)).toBe(0.6);
	});

	test("kimi-k2-thinking returns 1.0", () => {
		const m = makeModel({
			id: "moonshot/kimi-k2-thinking",
			apiModelId: "kimi-k2-thinking",
		});
		expect(ProviderTransform.temperature(m)).toBe(1.0);
	});

	test("generic model returns undefined", () => {
		expect(ProviderTransform.temperature(makeOpenAIModel())).toBeUndefined();
	});
});

// ── topP ─────────────────────────────────────────────────────

describe("ProviderTransform.topP", () => {
	test("qwen returns 1", () => {
		const m = makeModel({ id: "alibaba-cn/qwen-plus", apiModelId: "qwen-plus" });
		expect(ProviderTransform.topP(m)).toBe(1);
	});

	test("gemini returns 0.95", () => {
		expect(ProviderTransform.topP(makeGoogleModel())).toBe(0.95);
	});

	test("claude returns undefined", () => {
		expect(ProviderTransform.topP(makeModel())).toBeUndefined();
	});
});

// ── topK ─────────────────────────────────────────────────────

describe("ProviderTransform.topK", () => {
	test("gemini returns 64", () => {
		expect(ProviderTransform.topK(makeGoogleModel())).toBe(64);
	});

	test("claude returns undefined", () => {
		expect(ProviderTransform.topK(makeModel())).toBeUndefined();
	});
});

// ── maxOutputTokens ──────────────────────────────────────────

describe("ProviderTransform.maxOutputTokens", () => {
	test("caps at OUTPUT_TOKEN_MAX", () => {
		const m = makeModel({ limit: { context: 200000, output: 100000 } });
		expect(ProviderTransform.maxOutputTokens(m)).toBe(
			ProviderTransform.OUTPUT_TOKEN_MAX,
		);
	});

	test("uses model limit when smaller", () => {
		const m = makeModel({ limit: { context: 200000, output: 8000 } });
		expect(ProviderTransform.maxOutputTokens(m)).toBe(8000);
	});
});

// ── variants ─────────────────────────────────────────────────

describe("ProviderTransform.variants", () => {
	test("non-reasoning model returns empty", () => {
		expect(ProviderTransform.variants(makeOpenAIModel())).toEqual({});
	});

	test("anthropic adaptive model has adaptive thinking", () => {
		const m = makeModel({
			apiModelId: "claude-sonnet-4-6-20260514",
		});
		const v = ProviderTransform.variants(m);
		expect(v).toHaveProperty("low");
		expect(v).toHaveProperty("max");
		expect(v.low.thinking.type).toBe("adaptive");
	});

	test("anthropic non-adaptive model has enabled thinking", () => {
		const m = makeModel({
			apiModelId: "claude-sonnet-4-20250514",
		});
		const v = ProviderTransform.variants(m);
		expect(v).toHaveProperty("high");
		expect(v).toHaveProperty("max");
		expect(v.high.thinking.type).toBe("enabled");
		expect(v.high.thinking.budgetTokens).toBeGreaterThan(0);
	});

	test("google gemini-2.5 has thinkingConfig with budget", () => {
		const v = ProviderTransform.variants(makeGoogleModel());
		expect(v).toHaveProperty("high");
		expect(v.high.thinkingConfig.includeThoughts).toBe(true);
		expect(v.high.thinkingConfig.thinkingBudget).toBe(16000);
	});

	test("deepseek returns empty", () => {
		const m = makeModel({
			id: "deepseek/deepseek-r1",
			apiModelId: "deepseek-r1",
			npm: "@ai-sdk/openai-compatible",
		});
		expect(ProviderTransform.variants(m)).toEqual({});
	});
});

// ── options ──────────────────────────────────────────────────

describe("ProviderTransform.options", () => {
	test("openai sets store=false and promptCacheKey", () => {
		const opts = ProviderTransform.options({
			model: makeOpenAIModel(),
			sessionId: "test-session",
		});
		expect(opts.store).toBe(false);
		expect(opts.promptCacheKey).toBe("test-session");
	});

	test("google reasoning model sets thinkingConfig", () => {
		const opts = ProviderTransform.options({
			model: makeGoogleModel(),
			sessionId: "s1",
		});
		expect(opts.thinkingConfig).toBeDefined();
		expect(opts.thinkingConfig.includeThoughts).toBe(true);
	});

	test("anthropic model does not set store", () => {
		const opts = ProviderTransform.options({
			model: makeModel(),
			sessionId: "s1",
		});
		expect(opts.store).toBeUndefined();
	});
});

// ── providerOptions ──────────────────────────────────────────

describe("ProviderTransform.providerOptions", () => {
	test("wraps under SDK key for anthropic", () => {
		const result = ProviderTransform.providerOptions(makeModel(), {
			thinking: { type: "enabled", budgetTokens: 8000 },
		});
		expect(result).toHaveProperty("anthropic");
		expect(result.anthropic.thinking.type).toBe("enabled");
	});

	test("wraps under openai key", () => {
		const result = ProviderTransform.providerOptions(makeOpenAIModel(), {
			store: false,
		});
		expect(result).toHaveProperty("openai");
		expect(result.openai.store).toBe(false);
	});

	test("gateway splits gateway vs model-specific options", () => {
		const m = makeModel({
			npm: "@ai-sdk/gateway",
			apiModelId: "anthropic/claude-sonnet-4-20250514",
		});
		const result = ProviderTransform.providerOptions(m, {
			gateway: { caching: "auto" },
			thinking: { type: "enabled" },
		});
		expect(result.gateway).toEqual({ caching: "auto" });
		expect(result.anthropic).toEqual({ thinking: { type: "enabled" } });
	});
});

// ── smallOptions ─────────────────────────────────────────────

describe("ProviderTransform.smallOptions", () => {
	test("openai returns store=false", () => {
		const result = ProviderTransform.smallOptions(makeOpenAIModel());
		expect(result).toEqual({ store: false });
	});

	test("google returns thinkingBudget=0", () => {
		const result = ProviderTransform.smallOptions(makeGoogleModel());
		expect(result).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
	});
});

// ── message (normalization + caching) ────────────────────────

describe("ProviderTransform.message", () => {
	test("applies caching for anthropic models", () => {
		const model = makeModel();
		const msgs: any[] = [
			{ role: "system", content: "You are helpful." },
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
		];
		const result = ProviderTransform.message(msgs, model, {});
		const system = result.find((m) => m.role === "system");
		const hasCache =
			system?.providerOptions?.anthropic?.cacheControl !== undefined;
		expect(hasCache).toBe(true);
	});

	test("does not apply caching for openai models", () => {
		const model = makeOpenAIModel();
		const msgs: any[] = [
			{ role: "system", content: "You are helpful." },
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
		];
		const result = ProviderTransform.message(msgs, model, {});
		const system = result.find((m) => m.role === "system");
		expect(system?.providerOptions?.anthropic).toBeUndefined();
	});

	test("filters empty text parts for anthropic", () => {
		const model = makeModel();
		const msgs: any[] = [
			{ role: "user", content: [{ type: "text", text: "" }] },
		];
		const result = ProviderTransform.message(msgs, model, {});
		expect(result.length).toBe(0);
	});

	test("scrubs toolCallId for claude models", () => {
		const model = makeModel();
		const msgs: any[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call@123#abc",
						toolName: "read",
						input: {},
					},
				],
			},
		];
		const result = ProviderTransform.message(msgs, model, {});
		const call = (result[0] as any).content[0];
		expect(call.toolCallId).toBe("call_123_abc");
		expect(call.toolCallId).not.toContain("@");
		expect(call.toolCallId).not.toContain("#");
	});

	test("replaces unsupported modality with error text", () => {
		const model = makeModel({
			capabilities: {
				reasoning: true,
				toolCall: true,
				structuredOutput: false,
				input: { text: true, image: false, audio: false, video: false, pdf: false },
				output: { text: true, image: false },
			},
		});
		const msgs: any[] = [
			{
				role: "user",
				content: [
					{ type: "file", mediaType: "image/png", data: "abc", filename: "photo.png" },
				],
			},
		];
		const result = ProviderTransform.message(msgs, model, {});
		const part = (result[0] as any).content[0];
		expect(part.type).toBe("text");
		expect(part.text).toContain("does not support image input");
	});
});

// ── schema (Gemini sanitization) ─────────────────────────────

describe("ProviderTransform.schema", () => {
	test("converts integer enums to strings for google", () => {
		const model = makeGoogleModel();
		const input: any = {
			type: "object",
			properties: {
				status: { type: "integer", enum: [1, 2, 3] },
			},
			required: ["status"],
		};
		const result = ProviderTransform.schema(model, input);
		expect(result.properties!.status.type).toBe("string");
		expect(result.properties!.status.enum).toEqual(["1", "2", "3"]);
	});

	test("adds items type for empty array schema", () => {
		const model = makeGoogleModel();
		const input: any = {
			type: "array",
		};
		const result = ProviderTransform.schema(model, input);
		expect(result.items).toEqual({ type: "string" });
	});

	test("filters required to only existing properties", () => {
		const model = makeGoogleModel();
		const input: any = {
			type: "object",
			properties: { a: { type: "string" } },
			required: ["a", "b", "c"],
		};
		const result = ProviderTransform.schema(model, input);
		expect(result.required).toEqual(["a"]);
	});

	test("non-google model passes schema through unchanged", () => {
		const model = makeModel();
		const input: any = {
			type: "object",
			properties: { x: { type: "integer", enum: [1, 2] } },
		};
		const result = ProviderTransform.schema(model, input);
		expect(result.properties!.x.type).toBe("integer");
		expect(result.properties!.x.enum).toEqual([1, 2]);
	});
});

// ── Integration with resolveModelInfo ────────────────────────

describe("ProviderTransform with real registry models", () => {
	test("resolveModelInfo output works with temperature", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		expect(ProviderTransform.temperature(m)).toBeUndefined();
	});

	test("resolveModelInfo output works with variants", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		const v = ProviderTransform.variants(m);
		expect(v).toHaveProperty("high");
		expect(v).toHaveProperty("max");
	});

	test("resolveModelInfo output works with options", () => {
		const m = resolveModelInfo("openai/gpt-4o");
		const opts = ProviderTransform.options({ model: m, sessionId: "s" });
		expect(opts.store).toBe(false);
	});

	test("resolveModelInfo output works with maxOutputTokens", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		const max = ProviderTransform.maxOutputTokens(m);
		expect(max).toBeGreaterThan(0);
		expect(max).toBeLessThanOrEqual(ProviderTransform.OUTPUT_TOKEN_MAX);
	});
});
