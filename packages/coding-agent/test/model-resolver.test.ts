import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@jayden/jai-ai";
import { ModelResolveError, resolveSettingsModel } from "../src/core/model-resolver.js";
import type { ResolvedSettings } from "../src/core/settings.js";

function makeSettings(overrides: Partial<ResolvedSettings> = {}): ResolvedSettings {
	return {
		model: "anthropic/claude-sonnet-4-20250514",
		provider: "anthropic",
		maxIterations: 25,
		language: "zh-CN",
		env: {},
		...overrides,
	};
}

// ── Direct registry (no custom providers) ───────────────────

describe("direct registry fallback", () => {
	test("returns string when no providers configured", () => {
		const result = resolveSettingsModel(makeSettings());
		expect(typeof result).toBe("string");
		expect(result).toBe("anthropic/claude-sonnet-4-20250514");
	});

	test("returns string when provider not in providers map", () => {
		const result = resolveSettingsModel(
			makeSettings({
				model: "openai/gpt-4o",
				providers: {
					zenmux: {
						enabled: true,
						api_base: "https://zenmux.ai/api",
						api_format: "anthropic",
						models: [{ id: "claude-sonnet-4-20250514" }],
					},
				},
			}),
		);
		expect(typeof result).toBe("string");
		expect(result).toBe("openai/gpt-4o");
	});
});

// ── Custom provider resolution ──────────────────────────────

describe("custom provider resolution", () => {
	test("resolves model through custom provider", () => {
		const result = resolveSettingsModel(
			makeSettings({
				model: "zenmux/claude-sonnet-4-20250514",
				providers: {
					zenmux: {
						enabled: true,
						api_key: "sk-test",
						api_base: "https://zenmux.ai/api/anthropic",
						api_format: "anthropic",
						models: [{ id: "claude-sonnet-4-20250514" }],
					},
				},
			}),
		);

		expect(typeof result).toBe("object");
		const info = result as ModelInfo;
		expect(info.config.provider).toBe("anthropic");
		expect(info.config.model).toBe("claude-sonnet-4-20250514");
		expect(info.config.apiKey).toBe("sk-test");
		expect(info.config.baseURL).toBe("https://zenmux.ai/api/anthropic");
		expect(info.capabilities.reasoning).toBe(true);
		expect(info.capabilities.toolCall).toBe(true);
		expect(info.capabilities.input.text).toBe(true);
		expect(info.limit.context).toBeGreaterThan(0);
	});

	test("openai-compatible sets name on config", () => {
		const result = resolveSettingsModel(
			makeSettings({
				model: "relay/gpt-4o",
				providers: {
					relay: {
						enabled: true,
						api_key: "sk-relay",
						api_base: "https://relay.example.com/v1",
						api_format: "openai-compatible",
						models: [{ id: "gpt-4o" }],
					},
				},
			}),
		);

		const info = result as ModelInfo;
		expect(info.config.provider).toBe("openai-compatible");
		expect(info.config.name).toBe("relay");
	});

	test("non openai-compatible does not set name", () => {
		const result = resolveSettingsModel(
			makeSettings({
				model: "zenmux/claude-sonnet-4-20250514",
				providers: {
					zenmux: {
						enabled: true,
						api_base: "https://zenmux.ai/api",
						api_format: "anthropic",
						models: [{ id: "claude-sonnet-4-20250514" }],
					},
				},
			}),
		);

		const info = result as ModelInfo;
		expect(info.config.name).toBeUndefined();
	});
});

// ── Whitelist validation ─────────────────────────────────────

describe("whitelist validation", () => {
	test("throws when model not in whitelist", () => {
		try {
			resolveSettingsModel(
				makeSettings({
					model: "zenmux/gpt-4o-mini",
					providers: {
						zenmux: {
							enabled: true,
							api_base: "https://zenmux.ai/api",
							api_format: "openai",
							models: [{ id: "gpt-4o" }],
						},
					},
				}),
			);
			expect.unreachable("should have thrown");
		} catch (e: any) {
			expect(ModelResolveError.isInstance(e)).toBe(true);
			expect(e.data).toContain("not in provider");
		}
	});

	test("throws when provider is disabled", () => {
		try {
			resolveSettingsModel(
				makeSettings({
					model: "zenmux/claude-sonnet-4-20250514",
					providers: {
						zenmux: {
							enabled: false,
							api_base: "https://zenmux.ai/api",
							api_format: "anthropic",
							models: [{ id: "claude-sonnet-4-20250514" }],
						},
					},
				}),
			);
			expect.unreachable("should have thrown");
		} catch (e: any) {
			expect(ModelResolveError.isInstance(e)).toBe(true);
			expect(e.data).toContain("disabled");
		}
	});
});

// ── Capability overrides ─────────────────────────────────────

describe("capability overrides", () => {
	test("uses model-level capabilities when provided", () => {
		const result = resolveSettingsModel(
			makeSettings({
				model: "zenmux/my-custom-model",
				providers: {
					zenmux: {
						enabled: true,
						api_base: "https://zenmux.ai/api",
						api_format: "openai",
						models: [
							{
								id: "my-custom-model",
								capabilities: {
									reasoning: true,
									toolCall: true,
									input: { text: true, image: true },
									output: { text: true },
								},
								limit: { context: 200000, output: 16384 },
							},
						],
					},
				},
			}),
		);

		const info = result as ModelInfo;
		expect(info.capabilities.reasoning).toBe(true);
		expect(info.capabilities.toolCall).toBe(true);
		expect(info.capabilities.input.image).toBe(true);
		expect(info.capabilities.input.audio).toBe(false);
		expect(info.capabilities.output.text).toBe(true);
		expect(info.limit.context).toBe(200000);
		expect(info.limit.output).toBe(16384);
	});

	test("defaults unset capability fields to false", () => {
		const result = resolveSettingsModel(
			makeSettings({
				model: "zenmux/minimal-model",
				providers: {
					zenmux: {
						enabled: true,
						api_base: "https://zenmux.ai/api",
						api_format: "openai",
						models: [
							{
								id: "minimal-model",
								capabilities: { toolCall: true },
							},
						],
					},
				},
			}),
		);

		const info = result as ModelInfo;
		expect(info.capabilities.reasoning).toBe(false);
		expect(info.capabilities.toolCall).toBe(true);
		expect(info.capabilities.structuredOutput).toBe(false);
		expect(info.capabilities.input.text).toBe(true);
		expect(info.capabilities.input.image).toBe(false);
		expect(info.limit.context).toBe(128000);
		expect(info.limit.output).toBe(4096);
	});

	test("throws for unknown model without capabilities", () => {
		try {
			resolveSettingsModel(
				makeSettings({
					model: "zenmux/totally-unknown-model",
					providers: {
						zenmux: {
							enabled: true,
							api_base: "https://zenmux.ai/api",
							api_format: "openai",
							models: [{ id: "totally-unknown-model" }],
						},
					},
				}),
			);
			expect.unreachable("should have thrown");
		} catch (e: any) {
			expect(ModelResolveError.isInstance(e)).toBe(true);
			expect(e.data).toContain("Cannot determine capabilities");
		}
	});
});

// ── Invalid model format ─────────────────────────────────────

describe("invalid model format", () => {
	test("throws on model without slash", () => {
		try {
			resolveSettingsModel(makeSettings({ model: "claude-sonnet" }));
			expect.unreachable("should have thrown");
		} catch (e: any) {
			expect(ModelResolveError.isInstance(e)).toBe(true);
			expect(e.data).toContain("Invalid model format");
		}
	});
});
