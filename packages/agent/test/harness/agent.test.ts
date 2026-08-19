import { describe, expect, test } from "bun:test";
import { AssistantMessageEventStream, type AssistantMessage, type Context, type Provider, zeroUsage } from "@jai/ai";
import { Type } from "@sinclair/typebox";
import { Agent, type AgentEvent, type AgentTool, InMemorySessionStore, openSession } from "../../src";
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

		await agent.updateAppState(() => ({ resolved: true }));
		await agent.invoke("hello");

		expect(agent.state.systemPrompt).toBe(testInstructions);
		const record = await store.load("s1");
		expect(record?.snapshot.entries.map((entry) => entry.type)).toEqual(["app_state", "message", "message"]);
		expect(record?.snapshot.appState).toEqual({ resolved: true });
	});

	test("keeps protocol repair attempts out of the durable session transcript", async () => {
		const store = new InMemorySessionStore<AppState>();
		const invalid: AssistantMessage = {
			...assistant('<invoke name="read_file"><parameter name="path">/x</parameter></invoke>'),
			stopReason: "error",
			error: {
				message: "Model emitted a text-based tool call instead of a native tool call.",
				code: "ai.protocol_violation",
				type: "model_output_protocol",
			},
		};
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([invalid, assistant("repaired")]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
			instructions: testInstructions,
		});

		await agent.invoke("hello");

		expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		const record = await store.load("s1");
		expect(record?.snapshot.entries.map((entry) => entry.type)).toEqual(["message", "message"]);
		expect(JSON.stringify(record?.snapshot)).not.toContain("<invoke");
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

	test("serializes concurrent App State mutations and persists each committed value", async () => {
		const store = new InMemorySessionStore<AppState>();
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
		});

		await Promise.all([
			agent.updateAppState((current) => ({ ...current, resolved: true })),
			agent.updateAppState((current) => ({ ...current, resolved: false })),
		]);

		const record = await store.load("s1");
		expect(agent.state.appState).toEqual({ resolved: false });
		expect(record?.snapshot.entries.filter((entry) => entry.type === "app_state")).toHaveLength(2);
		expect(record?.snapshot.appState).toEqual({ resolved: false });
	});

	test("copies setAppState input before the write is queued", async () => {
		const store = new InMemorySessionStore<AppState>();
		const agent = new Agent<AppState>({
			model,
			provider: providerFor([]),
			sessionHandle: await openSession(store, "s1", defaultAppState),
		});
		const next = { resolved: true };

		const write = agent.setAppState(next);
		next.resolved = false;
		await write;

		expect(agent.state.appState).toEqual({ resolved: true });
	});

	test("failed App State persistence leaves the in-memory value unchanged", async () => {
		const store = new InMemorySessionStore<AppState>();
		const handle = await openSession(store, "s1", defaultAppState);
		const agent = new Agent<AppState>({ model, provider: providerFor([]), sessionHandle: handle });
		const record = await store.load("s1");
		await store.append("s1", messageEntry("other", "x"), record?.revision ?? "");

		await expect(agent.updateAppState(() => ({ resolved: true }))).rejects.toThrow(/revision conflict/);
		expect(agent.state.appState).toEqual(defaultAppState);
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
		expect(record?.snapshot.entries).toHaveLength(2);
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

	// 这两项曾经在门面构造 CoreAgent 时被静默丢弃：类型上是 CoreAgentOptions 的合法字段，
	// 但没有出现在转发列表里，因此 --max-turns 与 provider 级参数一路传到门面后失效。
	test("maxIterations 传到 loop，工具循环达到上限时以 iterationLimit 停止", async () => {
		const echo: AgentTool = {
			name: "echo",
			description: "echo",
			parameters: Type.Object({}),
			async execute() {
				return { content: [{ type: "text", text: "ok" }] };
			},
		};
		const toolUse = (id: string): AssistantMessage => ({
			role: "assistant",
			content: [{ type: "toolCall", id, name: "echo", arguments: {} }],
			provider: "test",
			model: model.id,
			usage: zeroUsage(),
			stopReason: "toolUse",
			timestamp: 0,
		});

		const agent = new Agent<AppState>({
			model,
			// 模型始终要求继续调用工具；只有 maxIterations 能让循环停下来。
			// 上限失效时会取用第三个响应并抛 "Unexpected provider call"。
			provider: providerFor([toolUse("c1"), toolUse("c2"), toolUse("c3")]),
			instructions: testInstructions,
			tools: [echo],
			maxIterations: 2,
		});

		const messages = await agent.invoke("keep going");

		expect(messages.at(-1)).toMatchObject({
			role: "assistant",
			stopReason: "iterationLimit",
		});
	});

	test("providerOptions 透传到 provider.stream", async () => {
		const seen: (Record<string, Record<string, unknown>> | undefined)[] = [];
		const provider: Provider = {
			id: "test",
			stream(_model, _context: Context, options) {
				seen.push(options?.providerOptions);
				const stream = new AssistantMessageEventStream();
				const message = {
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "done" }],
					provider: "test",
					model: model.id,
					usage: zeroUsage(),
					stopReason: "stop" as const,
					timestamp: Date.now(),
				};
				stream.push({ type: "start", partial: message });
				stream.push({ type: "done", reason: "stop", message });
				return stream;
			},
		};

		const agent = new Agent<AppState>({
			model,
			provider,
			instructions: testInstructions,
			providerOptions: { test: { reasoning: true } },
		});

		await agent.invoke("hello");

		expect(seen).toEqual([{ test: { reasoning: true } }]);
	});
});
