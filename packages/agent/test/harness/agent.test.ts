import { describe, expect, test } from "bun:test";
import type { Context } from "@jai/ai";
import { Agent, type AgentEvent, InMemorySessionStore, openSession } from "../../src";
import { assistant, defaultAppState, messageEntry, model, providerFor, testInstructions, type AppState } from "../support/fixtures";

describe("Agent", () => {
	test("restores durable state from a session handle and persists the run", async () => {
		const store = new InMemorySessionStore<AppState>();
		const handle = await openSession(store, "s1", defaultAppState);
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: handle,
			instructions: testInstructions,
		});

		agent.updateAppState(() => ({ resolved: true }));
		await agent.invoke("hello");

		expect(agent.state.systemPrompt).toBe(testInstructions);
		const record = await store.load("s1");
		expect(record?.snapshot.entries.map((entry) => entry.type)).toEqual(["message", "message", "app_state"]);
		expect(record?.snapshot.appState).toEqual({ resolved: true });
	});

	test("a reopened session continues the same transcript", async () => {
		const store = new InMemorySessionStore<AppState>();
		const first = new Agent<AppState>({
			model,
			provider: providerFor([assistant("first")]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
			instructions: testInstructions,
		});
		await first.invoke("hello");

		const second = new Agent<AppState>({
			model,
			provider: providerFor([assistant("second")]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
			instructions: testInstructions,
		});
		await second.invoke("again");

		expect(second.state.messages).toHaveLength(4);
		expect(second.state.isRunning).toBe(false);
		const record = await store.load("s1");
		expect(record?.snapshot.entries.filter((entry) => entry.type === "message")).toHaveLength(4);
	});

	test("uses the provided instructions, not the snapshot", async () => {
		const contexts: Context[] = [];
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")], contexts),
			sessionHandle: await openSession(new InMemorySessionStore<AppState>(), "s1", defaultAppState),
			instructions: testInstructions,
		});

		await agent.invoke("hello");

		expect(contexts[0]?.systemPrompt).toBe(testInstructions);
	});

	test("persists an event before external listeners observe it", async () => {
		const store = new InMemorySessionStore<AppState>();
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
			instructions: testInstructions,
		});
		const persistedWhenSeen: number[] = [];

		agent.subscribe(async (event) => {
			if (event.type !== "message_end") return;
			const record = await store.load("s1");
			persistedWhenSeen.push(record?.snapshot.entries.length ?? 0);
		});
		await agent.invoke("hello");

		expect(persistedWhenSeen).toEqual([1, 2]);
	});

	test("a failed write fails the run instead of silently losing history", async () => {
		const store = new InMemorySessionStore<AppState>();
		const handle = await openSession(store, "s1", defaultAppState);
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: handle,
			instructions: testInstructions,
		});

		const published: AgentEvent["type"][] = [];
		agent.subscribe((event) => {
			published.push(event.type);
		});

		// 另一个写者抢先推进 revision，模拟违反单写者原则的客户端。
		const record = await store.load("s1");
		await store.append("s1", messageEntry("other", "x"), record?.revision ?? "");

		await expect(agent.invoke("hello")).rejects.toThrow(/revision conflict/);
		expect(agent.state.isRunning).toBe(false);
		// 写不进去的消息不能先被观察者看见。
		expect(published).not.toContain("message_end");
	});

	test("stream carries only the events of its own run", async () => {
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("first"), assistant("second")]),
			instructions: testInstructions,
		});
		const observed: AgentEvent[] = [];
		agent.subscribe((event) => {
			observed.push(event);
		});

		const streamed: AgentEvent[] = [];
		for await (const event of agent.stream("hello")) {
			streamed.push(event);
		}
		await agent.invoke("again");

		expect(streamed[0]).toEqual({ type: "agent_start" });
		expect(streamed.at(-1)?.type).toBe("agent_end");
		expect(observed).toHaveLength(streamed.length * 2);
	});

	test("reset clears the in-process transcript and leaves the durable log alone", async () => {
		const store = new InMemorySessionStore<AppState>();
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
			instructions: testInstructions,
		});

		await agent.invoke("hello");
		agent.reset();

		expect(agent.state.messages).toEqual([]);
		const record = await store.load("s1");
		expect(record?.snapshot.entries).toHaveLength(3);
	});

	test("refuses a session handle alongside a second source of durable state", async () => {
		const handle = await openSession(new InMemorySessionStore<AppState>(), "s1", defaultAppState);

		expect(
			() =>
				new Agent<AppState>({
					model,
					provider: providerFor([]),
					sessionHandle: handle,
					// biome-ignore lint/suspicious/noExplicitAny: 模拟绕过类型约束的 JS 调用方
					messages: [],
				} as any),
		).toThrow(/sessionHandle/);
	});

	test("每个事件都能 JSON round-trip", async () => {
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			instructions: testInstructions,
		});
		const events: AgentEvent[] = [];
		agent.subscribe((event) => {
			events.push(event);
		});

		await agent.invoke("hello");

		expect(events.length).toBeGreaterThan(0);
		for (const event of events) {
			expect(JSON.parse(JSON.stringify(event))).toEqual(event);
		}
	});

	test("surfaces core construction errors synchronously", () => {
		expect(
			() =>
				new Agent({
					model,
					provider: { id: "other", stream: providerFor([]).stream },
				}),
		).toThrow('Model "test-model" belongs to provider "test", not "other"');
	});
});

describe("Agent observers", () => {
	const boom = (label: string) => () => {
		throw new Error(label);
	};

	test("一个观察者出错不影响后续观察者，也不影响 invoke 的结果", async () => {
		const reported: string[] = [];
		const seen: AgentEvent["type"][] = [];
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			instructions: testInstructions,
			onObserverError: ({ error }) => {
				reported.push((error as Error).message);
			},
		});

		agent.subscribe(boom("dashboard is down"));
		agent.subscribe((event) => {
			seen.push(event.type);
		});

		await expect(agent.invoke("hello")).resolves.toHaveLength(2);
		expect(seen).toContain("message_end");
		// 每个事件都上报一次，说明失败没有被吞在第一条之后。
		expect(reported).toHaveLength(seen.length);
	});

	test("观察者出错不会让 stream 的 result 失败", async () => {
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			instructions: testInstructions,
		});
		agent.subscribe(boom("dashboard is down"));

		const run = agent.stream("hello");
		const streamed: AgentEvent["type"][] = [];
		for await (const event of run) streamed.push(event.type);

		expect(await run.result()).toHaveLength(2);
		expect(streamed).toContain("agent_end");
	});

	test("onEvent hook 与运行期订阅走同一套隔离规则", async () => {
		const reported: string[] = [];
		const seen: AgentEvent["type"][] = [];
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			instructions: testInstructions,
			hooks: {
				onEvent: [
					boom("hook is down"),
					(event) => {
						seen.push(event.type);
					},
				],
			},
			onObserverError: ({ error }) => {
				reported.push((error as Error).message);
			},
		});

		await expect(agent.invoke("hello")).resolves.toHaveLength(2);
		expect(seen).toContain("message_end");
		expect(new Set(reported)).toEqual(new Set(["hook is down"]));
	});

	test("onObserverError 自己抛错同样被隔离", async () => {
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([assistant("done")]),
			instructions: testInstructions,
			onObserverError: boom("reporter is down"),
		});
		agent.subscribe(boom("dashboard is down"));

		await expect(agent.invoke("hello")).resolves.toHaveLength(2);
	});
});
