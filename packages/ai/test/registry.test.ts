import { describe, expect, it } from "bun:test";
import { AssistantMessageEventStream } from "../src/event-stream";
import type { Provider } from "../src/provider";
import { ModelRegistry } from "../src/registry";
import type { Context, Model } from "../src/types";

function makeModel(provider: string, id: string): Model {
	return {
		id,
		name: id,
		api: "anthropic-messages",
		provider,
		baseUrl: "https://example.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 4096,
	};
}

function makeProvider(id: string): { provider: Provider; calls: Model[] } {
	const calls: Model[] = [];
	const provider: Provider = {
		id,
		stream(model) {
			calls.push(model);
			return new AssistantMessageEventStream();
		},
	};
	return { provider, calls };
}

const emptyContext: Context = { systemPrompt: "", messages: [], tools: [] };

describe("ModelRegistry", () => {
	it("looks up a model by ref after registration", () => {
		const registry = new ModelRegistry();
		const { provider } = makeProvider("anthropic");
		const model = makeModel("anthropic", "claude-opus-4-8");
		registry.register({ provider, models: [model] });

		expect(registry.getModel("anthropic/claude-opus-4-8")).toBe(model);
	});

	it("returns undefined for an unknown ref", () => {
		const registry = new ModelRegistry();
		expect(registry.getModel("anthropic/nope")).toBeUndefined();
	});

	it("lists all registered models", () => {
		const registry = new ModelRegistry();
		const { provider } = makeProvider("anthropic");
		registry.register({
			provider,
			models: [makeModel("anthropic", "a"), makeModel("anthropic", "b")],
		});
		expect(registry.listModels()).toHaveLength(2);
	});

	it("delegates stream to the matching provider with the resolved model", () => {
		const registry = new ModelRegistry();
		const { provider, calls } = makeProvider("anthropic");
		const model = makeModel("anthropic", "claude-opus-4-8");
		registry.register({ provider, models: [model] });

		registry.stream("anthropic/claude-opus-4-8", emptyContext);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe(model);
	});

	it("throws for an unregistered ref on stream", () => {
		const registry = new ModelRegistry();
		expect(() => registry.stream("anthropic/nope", emptyContext)).toThrow("not registered");
	});

	it("routes model ids that contain slashes (openrouter-style)", () => {
		const registry = new ModelRegistry();
		const { provider, calls } = makeProvider("openrouter");
		const model = makeModel("openrouter", "anthropic/claude-opus");
		registry.register({ provider, models: [model] });

		expect(registry.getModel("openrouter/anthropic/claude-opus")).toBe(model);
		registry.stream("openrouter/anthropic/claude-opus", emptyContext);
		expect(calls[0]).toBe(model);
	});

	it("overwrites a provider re-registered under the same id", () => {
		const registry = new ModelRegistry();
		const first = makeProvider("anthropic");
		const second = makeProvider("anthropic");
		const model = makeModel("anthropic", "claude-opus-4-8");

		registry.register({ provider: first.provider, models: [model] });
		registry.register({ provider: second.provider, models: [model] });

		registry.stream("anthropic/claude-opus-4-8", emptyContext);
		expect(first.calls).toHaveLength(0);
		expect(second.calls).toHaveLength(1);
	});
});
