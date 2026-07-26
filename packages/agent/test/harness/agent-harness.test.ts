import { describe, expect, test } from "bun:test";
import type { Context } from "@jai/ai";
import { AgentHarness, type HarnessEvent, InMemorySessionStore, openSession } from "../../src/harness";
import { assistant, messageEntry, model, providerFor, sessionInit, type AppState } from "../support/fixtures";

describe("AgentHarness", () => {
	test("restores durable state from a session handle and persists the run", async () => {
		const store = new InMemorySessionStore<AppState>();
		const handle = await openSession(store, "s1", sessionInit);
		const harness = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: handle,
		});

		harness.updateAppState(() => ({ resolved: true }));
		await harness.invoke("hello");

		expect(harness.state.systemPrompt).toBe(sessionInit.systemPrompt);
		const record = await store.load("s1");
		expect(record?.snapshot.entries.map((entry) => entry.type)).toEqual(["message", "message", "app_state"]);
		expect(record?.snapshot.appState).toEqual({ resolved: true });
	});

	test("a reopened session continues the same transcript", async () => {
		const store = new InMemorySessionStore<AppState>();
		const first = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("first")]),
			sessionHandle: await openSession(store, "s1", sessionInit),
		});
		await first.invoke("hello");

		const second = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("second")]),
			sessionHandle: await openSession(store, "s1", sessionInit),
		});
		await second.invoke("again");

		expect(second.state.messages).toHaveLength(4);
		expect(second.state.isRunning).toBe(false);
		const record = await store.load("s1");
		expect(record?.snapshot.entries.filter((entry) => entry.type === "message")).toHaveLength(4);
	});

	test("keeps the restored system prompt", async () => {
		const contexts: Context[] = [];
		const harness = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("done")], contexts),
			sessionHandle: await openSession(new InMemorySessionStore<AppState>(), "s1", sessionInit),
		});

		await harness.invoke("hello");

		expect(contexts[0]?.systemPrompt).toBe(sessionInit.systemPrompt);
	});

	test("persists an event before external listeners observe it", async () => {
		const store = new InMemorySessionStore<AppState>();
		const harness = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: await openSession(store, "s1", sessionInit),
		});
		const persistedWhenSeen: number[] = [];

		harness.subscribe(async (event) => {
			if (event.type !== "message_end") return;
			const record = await store.load("s1");
			persistedWhenSeen.push(record?.snapshot.entries.length ?? 0);
		});
		await harness.invoke("hello");

		expect(persistedWhenSeen).toEqual([1, 2]);
	});

	test("a failed write fails the run instead of silently losing history", async () => {
		const store = new InMemorySessionStore<AppState>();
		const handle = await openSession(store, "s1", sessionInit);
		const harness = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: handle,
		});

		// 另一个写者抢先推进 revision，模拟违反单写者原则的客户端。
		const record = await store.load("s1");
		await store.append("s1", messageEntry("other", "x"), record?.revision ?? "");

		await expect(harness.invoke("hello")).rejects.toThrow(/revision conflict/);
		expect(harness.state.isRunning).toBe(false);
	});

	test("stream carries only the events of its own run", async () => {
		const harness = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("first"), assistant("second")]),
			instructions: sessionInit.systemPrompt,
		});
		const observed: HarnessEvent[] = [];
		harness.subscribe((event) => {
			observed.push(event);
		});

		const streamed: HarnessEvent[] = [];
		for await (const event of harness.stream("hello")) {
			streamed.push(event);
		}
		await harness.invoke("again");

		expect(streamed[0]).toEqual({ type: "agent_start" });
		expect(streamed.at(-1)?.type).toBe("agent_end");
		expect(observed).toHaveLength(streamed.length * 2);
	});

	test("reset clears the in-process transcript and leaves the durable log alone", async () => {
		const store = new InMemorySessionStore<AppState>();
		const harness = new AgentHarness<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: await openSession(store, "s1", sessionInit),
		});

		await harness.invoke("hello");
		harness.reset();

		expect(harness.state.messages).toEqual([]);
		const record = await store.load("s1");
		expect(record?.snapshot.entries).toHaveLength(3);
	});

	test("refuses a session handle alongside a second source of durable state", async () => {
		const handle = await openSession(new InMemorySessionStore<AppState>(), "s1", sessionInit);

		expect(
			() =>
				new AgentHarness<AppState>({
					model,
					provider: providerFor([]),
					sessionHandle: handle,
					// biome-ignore lint/suspicious/noExplicitAny: 模拟绕过类型约束的 JS 调用方
					instructions: "Another prompt",
				} as any),
		).toThrow(/sessionHandle/);
	});

	test("surfaces core construction errors synchronously", () => {
		expect(
			() =>
				new AgentHarness({
					model,
					provider: { id: "other", stream: providerFor([]).stream },
				}),
		).toThrow('Model "test-model" belongs to provider "test", not "other"');
	});
});
