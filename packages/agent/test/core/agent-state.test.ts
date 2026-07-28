import { describe, expect, test } from "bun:test";
import { cloneJson } from "../../src";
import { CoreAgent, type CoreAgentEvent } from "../../src/core";
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

describe("CoreAgent state", () => {
	function createAgent() {
		return new CoreAgent<{ resolved: boolean; tags: string[] }>({
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

describe("CoreAgent subscribe", () => {
	test("delivers the same events to invoke() and stream() subscribers", async () => {
		const invoked: CoreAgentEvent["type"][] = [];
		const agent = new CoreAgent({ model, provider: providerFor([assistant("done"), assistant("done again")]) });
		const unsubscribe = agent.subscribe((event) => {
			invoked.push(event.type);
		});

		await agent.invoke("hello");
		const first = [...invoked];
		invoked.length = 0;

		const streamed: CoreAgentEvent["type"][] = [];
		for await (const event of agent.stream("hello again")) {
			streamed.push(event.type);
		}
		unsubscribe();

		expect(streamed).toEqual(first);
		expect(invoked).toEqual(first);
	});

	test("stops delivering after unsubscribe", async () => {
		const seen: CoreAgentEvent["type"][] = [];
		const agent = new CoreAgent({ model, provider: providerFor([assistant("done")]) });

		agent.subscribe((event) => {
			seen.push(event.type);
		})();
		await agent.invoke("hello");

		expect(seen).toEqual([]);
	});

	test("a failing listener neither stops the run nor blocks the next listener", async () => {
		const reported: string[] = [];
		const seen: CoreAgentEvent["type"][] = [];
		const agent = new CoreAgent({
			model,
			provider: providerFor([assistant("done")]),
			onObserverError: ({ error }) => {
				reported.push((error as Error).message);
			},
		});

		agent.subscribe(() => {
			throw new Error("dashboard is down");
		});
		agent.subscribe((event) => {
			seen.push(event.type);
		});

		const messages = await agent.invoke("hello");

		expect(messages).toHaveLength(2);
		expect(seen).toContain("message_end");
		expect(new Set(reported)).toEqual(new Set(["dashboard is down"]));
	});

	test("a failing onObserverError is swallowed too", async () => {
		const agent = new CoreAgent({
			model,
			provider: providerFor([assistant("done")]),
			onObserverError: () => {
				throw new Error("reporter is down");
			},
		});
		agent.subscribe(() => {
			throw new Error("dashboard is down");
		});

		await expect(agent.invoke("hello")).resolves.toHaveLength(2);
	});

	test("commitEvent failure fails the run", async () => {
		const agent = new CoreAgent({
			model,
			provider: providerFor([assistant("done")]),
			commitEvent: (event) => {
				if (event.type === "message_end") throw new Error("persistence is down");
			},
		});

		await expect(agent.invoke("hello")).rejects.toThrow("persistence is down");
		expect(agent.state.isRunning).toBe(false);
	});

	test("commitEvent runs before observers see the event", async () => {
		const order: string[] = [];
		const agent = new CoreAgent({
			model,
			provider: providerFor([assistant("done")]),
			commitEvent: (event) => {
				if (event.type === "message_end") order.push("commit");
			},
		});
		agent.subscribe((event) => {
			if (event.type === "message_end") order.push("observe");
		});

		await agent.invoke("hello");

		expect(order).toEqual(["commit", "observe", "commit", "observe"]);
	});
});
