import { describe, expect, test } from "bun:test";
import {
	ModelNotFoundError,
	getModel,
	getProvider,
	listModels,
	listProviders,
	npmToSdkType,
	resolveModelInfo,
} from "../src/models.js";

// ── Registry Lookup ──────────────────────────────────────────

describe("getProvider", () => {
	test("returns anthropic provider", () => {
		const p = getProvider("anthropic");
		expect(p).toBeDefined();
		expect(p!.id).toBe("anthropic");
		expect(p!.npm).toBe("@ai-sdk/anthropic");
		expect(p!.env).toContain("ANTHROPIC_API_KEY");
	});

	test("returns openai provider", () => {
		const p = getProvider("openai");
		expect(p).toBeDefined();
		expect(p!.npm).toBe("@ai-sdk/openai");
	});

	test("returns google provider", () => {
		const p = getProvider("google");
		expect(p).toBeDefined();
		expect(p!.npm).toBe("@ai-sdk/google");
	});

	test("returns undefined for nonexistent provider", () => {
		expect(getProvider("nonexistent-provider-xyz")).toBeUndefined();
	});
});

describe("getModel", () => {
	test("returns a known anthropic model", () => {
		const m = getModel("anthropic", "claude-sonnet-4-20250514");
		expect(m).toBeDefined();
		expect(m!.reasoning).toBe(true);
		expect(m!.tool_call).toBe(true);
		expect(m!.modalities.input).toContain("text");
	});

	test("returns gpt-4o", () => {
		const m = getModel("openai", "gpt-4o");
		expect(m).toBeDefined();
		expect(m!.tool_call).toBe(true);
		expect(m!.limit.context).toBeGreaterThan(0);
		expect(m!.cost).toBeDefined();
	});

	test("returns undefined for nonexistent model", () => {
		expect(getModel("anthropic", "claude-nonexistent")).toBeUndefined();
	});

	test("returns undefined for nonexistent provider", () => {
		expect(getModel("fake-provider", "fake-model")).toBeUndefined();
	});
});

describe("listProviders", () => {
	test("returns a non-empty array", () => {
		const providers = listProviders();
		expect(providers.length).toBeGreaterThan(10);
		expect(providers).toContain("anthropic");
		expect(providers).toContain("openai");
		expect(providers).toContain("google");
	});
});

describe("listModels", () => {
	test("returns models for anthropic", () => {
		const models = listModels("anthropic");
		expect(models.length).toBeGreaterThan(0);
		expect(models).toContain("claude-sonnet-4-20250514");
	});

	test("returns empty array for nonexistent provider", () => {
		expect(listModels("nonexistent")).toEqual([]);
	});
});

// ── npmToSdkType ─────────────────────────────────────────────

describe("npmToSdkType", () => {
	test("maps known packages", () => {
		expect(npmToSdkType("@ai-sdk/anthropic")).toBe("anthropic");
		expect(npmToSdkType("@ai-sdk/openai")).toBe("openai");
		expect(npmToSdkType("@ai-sdk/google")).toBe("google");
	});

	test("falls back to openai-compatible", () => {
		expect(npmToSdkType("@ai-sdk/xai")).toBe("openai-compatible");
		expect(npmToSdkType("some-random-pkg")).toBe("openai-compatible");
	});
});

// ── resolveModelInfo ─────────────────────────────────────────

describe("resolveModelInfo", () => {
	test("resolves anthropic/claude-sonnet-4-20250514", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		expect(m.id).toBe("anthropic/claude-sonnet-4-20250514");
		expect(m.providerId).toBe("anthropic");
		expect(m.npm).toBe("@ai-sdk/anthropic");
		expect(m.apiModelId).toBe("claude-sonnet-4-20250514");
		expect(m.config.provider).toBe("anthropic");
		expect(m.config.model).toBe("claude-sonnet-4-20250514");
		expect(m.capabilities.reasoning).toBe(true);
		expect(m.capabilities.toolCall).toBe(true);
		expect(m.capabilities.input.text).toBe(true);
		expect(m.capabilities.input.image).toBe(true);
		expect(m.limit.context).toBeGreaterThan(0);
		expect(m.limit.output).toBeGreaterThan(0);
		expect(m.cost).toBeDefined();
		expect(m.cost!.input).toBeGreaterThan(0);
	});

	test("resolves openai/gpt-4o", () => {
		const m = resolveModelInfo("openai/gpt-4o");
		expect(m.config.provider).toBe("openai");
		expect(m.npm).toBe("@ai-sdk/openai");
		expect(m.capabilities.toolCall).toBe(true);
		expect(m.capabilities.reasoning).toBe(false);
	});

	test("resolves google model", () => {
		const models = listModels("google");
		expect(models.length).toBeGreaterThan(0);
		const m = resolveModelInfo(`google/${models[0]}`);
		expect(m.config.provider).toBe("google");
		expect(m.npm).toBe("@ai-sdk/google");
	});

	test("resolves openai-compatible provider", () => {
		const providers = listProviders();
		const compatProvider = providers.find((id) => {
			const p = getProvider(id);
			return (
				p &&
				p.npm !== "@ai-sdk/anthropic" &&
				p.npm !== "@ai-sdk/openai" &&
				p.npm !== "@ai-sdk/google" &&
				Object.keys(p.models).length > 0
			);
		});
		if (!compatProvider) return;

		const models = listModels(compatProvider);
		const m = resolveModelInfo(`${compatProvider}/${models[0]}`);
		expect(m.config.provider).toBe("openai-compatible");
		expect(m.config.name).toBe(compatProvider);
	});

	test("applies apiKey override", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514", {
			apiKey: "sk-test-key",
		});
		expect(m.config.apiKey).toBe("sk-test-key");
	});

	test("applies baseURL override", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514", {
			baseURL: "https://custom.api.com",
		});
		expect(m.config.baseURL).toBe("https://custom.api.com");
	});

	test("extracts family", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		expect(m.family).toBeDefined();
		expect(typeof m.family).toBe("string");
	});

	test("extracts releaseDate when available", () => {
		const m = resolveModelInfo("openai/gpt-4o");
		if (m.releaseDate) {
			expect(m.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});

	test("extracts cost with cache fields", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		expect(m.cost).toBeDefined();
		expect(typeof m.cost!.input).toBe("number");
		expect(typeof m.cost!.output).toBe("number");
		if (m.cost!.cacheRead !== undefined) {
			expect(typeof m.cost!.cacheRead).toBe("number");
		}
	});

	test("throws on invalid format (no slash)", () => {
		expect(() => resolveModelInfo("claude-sonnet-4")).toThrow();
	});

	test("throws on unknown provider", () => {
		expect(() => resolveModelInfo("fake-provider/model")).toThrow();
	});

	test("throws on unknown model", () => {
		expect(() =>
			resolveModelInfo("anthropic/claude-nonexistent-999"),
		).toThrow();
	});
});

// ── Capabilities extraction ──────────────────────────────────

describe("capabilities extraction", () => {
	test("multimodal model has image input", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		expect(m.capabilities.input.image).toBe(true);
	});

	test("text-only model has no image input", () => {
		const providers = listProviders();
		for (const pid of providers) {
			const models = listModels(pid);
			for (const mid of models) {
				const regModel = getModel(pid, mid);
				if (
					regModel &&
					!regModel.modalities?.input?.includes("image")
				) {
					const m = resolveModelInfo(`${pid}/${mid}`);
					expect(m.capabilities.input.image).toBe(false);
					return;
				}
			}
		}
	});

	test("structuredOutput is set correctly", () => {
		const m = resolveModelInfo("openai/gpt-4o");
		expect(typeof m.capabilities.structuredOutput).toBe("boolean");
	});
});
