import { describe, expect, test } from "bun:test";
import { Agent, type AgentEvent, cloneJson } from "../../src";
import { assistant, model, providerFor } from "../support/fixtures";

describe("cloneJson", () => {
	test("accepts plain JSON structures and returns a deep copy", () => {
		const source = { nested: { list: [1, "two", true, null] } };
		const copy = cloneJson(source);

		expect(copy).toEqual(source);
		expect(copy.nested).not.toBe(source.nested);
	});

	test("rejects values that JSON cannot represent", () => {
		expect(() => cloneJson({ when: new Date() } as never)).toThrow(TypeError);
		expect(() => cloneJson({ seen: new Map() } as never)).toThrow(TypeError);
		expect(() => cloneJson({ run: () => {} } as never)).toThrow(TypeError);
		expect(() => cloneJson({ amount: Number.NaN } as never)).toThrow(TypeError);
		expect(() => cloneJson({ value: undefined } as never)).toThrow(TypeError);
	});

	test("rejects cycles", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		expect(() => cloneJson(cyclic as never)).toThrow(/cycle/);
	});
});

describe("Agent state", () => {
	function createAgent() {
		return new Agent<{ resolved: boolean; tags: string[] }>({
			model,
			provider: providerFor([assistant("done")]),
			instructions: "You are helpful.",
			appState: { resolved: false, tags: [] },
		});
	}

	test("exposes a defensive copy that callers cannot mutate", () => {
		const agent = createAgent();

		agent.state.appState.tags.push("leaked");

		expect(agent.state.appState.tags).toEqual([]);
		expect(agent.state.pendingToolCallIds.size).toBe(0);
		expect(agent.state.isRunning).toBe(false);
	});

	test("updateAppState replaces business state without touching the transcript", async () => {
		const agent = createAgent();
		await agent.invoke("hello");

		agent.updateAppState((current) => ({ ...current, resolved: true }));

		expect(agent.state.appState).toEqual({ resolved: true, tags: [] });
		expect(agent.state.messages).toHaveLength(2);
	});

	test("rejects non-JSON business state at the write boundary", () => {
		const agent = createAgent();

		expect(() => agent.setAppState({ resolved: false, tags: [], when: new Date() } as never)).toThrow(TypeError);
	});
});

describe("Agent subscribe", () => {
	test("delivers the same events to invoke() and stream() subscribers", async () => {
		const invoked: AgentEvent["type"][] = [];
		const agent = new Agent({ model, provider: providerFor([assistant("done"), assistant("done again")]) });
		const unsubscribe = agent.subscribe((event) => {
			invoked.push(event.type);
		});

		await agent.invoke("hello");
		const first = [...invoked];
		invoked.length = 0;

		const streamed: AgentEvent["type"][] = [];
		for await (const event of agent.stream("hello again")) {
			streamed.push(event.type);
		}
		unsubscribe();

		expect(streamed).toEqual(first);
		expect(invoked).toEqual(first);
	});

	test("stops delivering after unsubscribe", async () => {
		const seen: AgentEvent["type"][] = [];
		const agent = new Agent({ model, provider: providerFor([assistant("done")]) });

		agent.subscribe((event) => {
			seen.push(event.type);
		})();
		await agent.invoke("hello");

		expect(seen).toEqual([]);
	});

	test("a failing listener fails the whole run", async () => {
		const agent = new Agent({ model, provider: providerFor([assistant("done")]) });
		agent.subscribe((event) => {
			if (event.type === "message_end") throw new Error("persistence is down");
		});

		await expect(agent.invoke("hello")).rejects.toThrow("persistence is down");
		expect(agent.state.isRunning).toBe(false);
	});
});
