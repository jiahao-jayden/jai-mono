import { describe, expect, it } from "bun:test";
import { resolveCompatibilityProfile, resolveRequestPolicy, type ModelIdentity } from "../src/compatibility";

const identity: ModelIdentity = {
	provider: "deepseek-gateway",
	adapter: "openai-compatible",
	remoteModelId: "deepseek-reasoner",
	family: "deepseek-reasoner",
	endpoint: "https://gateway.example/v1",
};

describe("compatibility profile resolver", () => {
	it("resolves an independent request policy for token, usage, tools, and reasoning", () => {
		const profile = resolveCompatibilityProfile(identity, [], {
			maxTokensField: "max_tokens",
			supportsUsageInStreaming: false,
			supportsStrictTools: false,
			reasoningFormat: "none",
		});
		if (profile.isErr()) throw profile.error;
		expect(resolveRequestPolicy(profile.value, { reasoningRequested: true })).toEqual({
			maxTokensField: "max_tokens",
			supportsUsageInStreaming: false,
			supportsStrictTools: false,
			reasoningEnabled: false,
		});
	});
	it("uses matched layers in source priority order", () => {
		const result = resolveCompatibilityProfile(
			identity,
			[
				{ source: "dialect", rules: { maxTokensField: "max_completion_tokens" } },
				{ source: "provider", rules: { reasoningFormat: "openai" } },
				{ source: "family", rules: { reasoningFormat: "deepseek" } },
				{ source: "identity", rules: { maxTokensField: "max_tokens" } },
			],
		);

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.rules).toEqual({ maxTokensField: "max_tokens", reasoningFormat: "deepseek" });
		}
	});

	it("uses a base profile for an unknown model without fuzzy matching", () => {
		const result = resolveCompatibilityProfile({ ...identity, remoteModelId: "deepseek-reasoner-2026" });

		expect(result.isOk()).toBe(true);
		if (result.isOk()) expect(result.value.rules).toEqual({});
	});

	it("fails closed when matched layers at the same priority disagree", () => {
		const result = resolveCompatibilityProfile(identity, [
			{ source: "identity", rules: { reasoningFormat: "deepseek" } },
			{ source: "identity", rules: { reasoningFormat: "openai" } },
		]);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error).toMatchObject({ _tag: "ai_compatibility.resolution_failed", code: "conflict" });
	});

	it("rejects conflicting explicit overrides instead of silently replacing a rule", () => {
		const result = resolveCompatibilityProfile(
			identity,
			[{ source: "identity", rules: { maxTokensField: "max_tokens" } }],
			{ maxTokensField: "max_completion_tokens" },
		);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error).toMatchObject({ code: "conflict", field: "maxTokensField" });
	});

	it("fails closed when two rules at the winning priority disagree", () => {
		const result = resolveCompatibilityProfile(identity, [
			{ source: "family", rules: { reasoningFormat: "deepseek" } },
			{ source: "family", rules: { reasoningFormat: "openai" } },
		]);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error).toMatchObject({ code: "conflict", field: "reasoningFormat" });
	});
});
