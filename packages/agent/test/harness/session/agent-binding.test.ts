import { describe, expect, test } from "bun:test";
import { Agent } from "../../../src";
import {
	attachSessionStore,
	InMemorySessionStore,
	openSession,
	toAgentOptions,
	toSnapshot,
} from "../../../src/harness";
import { assistant, createAgent, messageEntry, model, providerFor, sessionInit, type AppState } from "../../support/fixtures";

describe("toSnapshot / toAgentOptions", () => {
	test("projects the same state to identical entries every time", async () => {
		const agent = createAgent();
		await agent.invoke("hello");

		const first = toSnapshot("s1", agent.state, "2026-01-01T00:00:00.000Z");
		const second = toSnapshot("s1", agent.state, "2026-01-01T00:00:00.000Z");

		expect(first).toEqual(second);
		expect(first.entries.map((entry) => entry.id)).toEqual(["s1:0", "s1:1"]);
	});

	test("restores only durable state", async () => {
		const agent = createAgent();
		await agent.invoke("hello");
		agent.updateAppState(() => ({ resolved: true }));

		const restored = new Agent<AppState>({
			model,
			provider: providerFor([]),
			...toAgentOptions(toSnapshot("s1", agent.state, "2026-01-01T00:00:00.000Z")),
		});

		expect(restored.state.messages).toEqual(agent.state.messages);
		expect(restored.state.appState).toEqual({ resolved: true });
		expect(restored.state.systemPrompt).toBe(sessionInit.systemPrompt);
		expect(restored.state.isRunning).toBe(false);
		expect(restored.state.pendingToolCallIds.size).toBe(0);
	});
});

describe("attachSessionStore", () => {
	test("persists messages per run and business state at agent_end", async () => {
		const store = new InMemorySessionStore<AppState>();
		const session = await openSession(store, "s1", sessionInit);
		const agent = createAgent();

		const unsubscribe = attachSessionStore(agent, session);
		agent.updateAppState(() => ({ resolved: true }));
		await agent.invoke("hello");
		unsubscribe();

		const record = await store.load("s1");
		expect(record?.snapshot.entries.map((entry) => entry.type)).toEqual(["message", "message", "app_state"]);
		expect(record?.snapshot.appState).toEqual({ resolved: true });
	});

	test("a restored Agent continues the same transcript", async () => {
		const store = new InMemorySessionStore<AppState>();
		const first = await openSession(store, "s1", sessionInit);
		const agent = createAgent();
		const detach = attachSessionStore(agent, first);
		await agent.invoke("hello");
		detach();

		const reopened = await openSession(store, "s1", sessionInit);
		const restored = new Agent<AppState>({
			model,
			provider: providerFor([assistant("second")]),
			...toAgentOptions(reopened.snapshot),
		});
		attachSessionStore(restored, reopened);
		await restored.invoke("again");

		const record = await store.load("s1");
		expect(record?.snapshot.entries.filter((entry) => entry.type === "message")).toHaveLength(4);
		expect(restored.state.messages).toHaveLength(4);
	});

	test("a failed write fails the run instead of silently losing history", async () => {
		const store = new InMemorySessionStore<AppState>();
		const session = await openSession(store, "s1", sessionInit);
		const agent = createAgent();
		attachSessionStore(agent, session);

		// 另一个写者抢先推进 revision，模拟违反单写者原则的客户端。
		const record = await store.load("s1");
		await store.append("s1", messageEntry("other", "x"), record?.revision ?? "");

		await expect(agent.invoke("hello")).rejects.toThrow(/revision conflict/);
	});
});
