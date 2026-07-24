import { describe, expect, test } from "bun:test";
import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type Provider,
	type UserMessage,
	zeroUsage,
} from "@jai/ai";
import { Type } from "@sinclair/typebox";
import { Agent, type AgentEvent, type AgentTool } from "../../src";

const model: Model = {
	id: "test-model",
	name: "Test Model",
	api: "test",
	provider: "test",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 10_000,
	maxTokens: 1_000,
};

function user(text: string): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function providerFor(responses: AssistantMessage[], contexts: Context[] = []): Provider {
	let index = 0;

	return {
		id: "test",
		stream(_model, context) {
			contexts.push({
				...context,
				messages: [...context.messages],
				tools: [...context.tools],
			});

			const message = responses[index++];
			if (!message) throw new Error("Unexpected provider call");

			const stream = new AssistantMessageEventStream();
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				stream.push({
					type: "error",
					reason: message.stopReason,
					error: message,
				});
			} else {
				stream.push({ type: "start", partial: message });
				stream.push({
					type: "done",
					reason: message.stopReason,
					message,
				});
			}
			return stream;
		},
	};
}

function createAgent(provider: Provider, tools: AgentTool[] = []): Agent {
	return new Agent({
		model,
		provider,
		instructions: "You are helpful.",
		tools,
	});
}

interface ControlledCall {
	context: Context;
	stream: AssistantMessageEventStream;
}

function createControlledProvider(): {
	provider: Provider;
	nextCall: () => Promise<ControlledCall>;
} {
	const calls: ControlledCall[] = [];
	const waiters: Array<(call: ControlledCall) => void> = [];

	return {
		provider: {
			id: "test",
			stream(_model, context) {
				const call = {
					context: {
						...context,
						messages: [...context.messages],
						tools: [...context.tools],
					},
					stream: new AssistantMessageEventStream(),
				};
				const resolve = waiters.shift();
				if (resolve) resolve(call);
				else calls.push(call);
				return call.stream;
			},
		},
		nextCall: () => {
			const call = calls.shift();
			return call ? Promise.resolve(call) : new Promise((resolve) => waiters.push(resolve));
		},
	};
}

function finish(call: ControlledCall, message: AssistantMessage): void {
	call.stream.push({ type: "start", partial: message });
	call.stream.push({ type: "done", reason: "stop", message });
}

describe("Agent", () => {
	test("keeps the run active through agent_end and finishes idle", async () => {
		const agent = createAgent(providerFor([assistant("done")]));
		let isRunningAtEnd: boolean | undefined;
		let signalAtStart: AbortSignal | undefined;

		const run = agent.stream(user("start"));
		for await (const event of run) {
			if (event.type === "agent_start") {
				signalAtStart = agent.signal;
			}
			if (event.type === "agent_end") {
				isRunningAtEnd = agent.getSession().isRunning;
			}
		}

		expect(signalAtStart).toBeInstanceOf(AbortSignal);
		expect(isRunningAtEnd).toBe(true);
		expect(agent.getSession().isRunning).toBe(false);
		expect(agent.signal).toBeUndefined();
		expect(agent.getSession().pendingToolCallIds.length).toBe(0);
	});

	test("reduces each event before yielding it from stream", async () => {
		const agent = createAgent(providerFor([assistant("done")]));
		const statesAtMessageStart: Array<string | undefined> = [];

		for await (const event of agent.stream(user("start"))) {
			if (event.type === "message_start") {
				statesAtMessageStart.push(agent.getSession().streamingMessage?.role);
			}
		}

		expect(statesAtMessageStart).toEqual(["user", "assistant"]);
		expect(agent.getSession().streamingMessage).toBeUndefined();
		expect(agent.getSession().messages.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	test("abort is a no-op while idle", () => {
		const agent = createAgent(providerFor([]));

		expect(() => agent.abort()).not.toThrow();
	});

	test("rejects queued messages while idle", () => {
		const agent = createAgent(providerFor([]));

		expect(() => agent.steer(user("steer"))).toThrow("Agent is idle");
		expect(() => agent.followUp(user("follow up"))).toThrow("Agent is idle");
	});

	test("rejects concurrent invocations", async () => {
		const stream = new AssistantMessageEventStream();
		const provider: Provider = {
			id: "test",
			stream() {
				return stream;
			},
		};
		const agent = createAgent(provider);
		const firstInvocation = agent.invoke(user("first"));

		expect(() => agent.invoke(user("second"))).toThrow("Agent is already running");

		const reply = assistant("done");
		stream.push({ type: "start", partial: reply });
		stream.push({ type: "done", reason: "stop", message: reply });

		await firstInvocation;
		expect(agent.getSession().isRunning).toBe(false);
	});

	test("injects steering before follow-up through its internal queues", async () => {
		const { provider, nextCall } = createControlledProvider();
		const agent = createAgent(provider);
		const steering = user("steer");
		const followUp = user("follow up");
		const run = agent.invoke(user("start"));

		const first = await nextCall();
		agent.steer(steering);
		agent.followUp(followUp);
		finish(first, assistant("first reply"));

		const second = await nextCall();
		expect(second.context.messages).toContain(steering);
		expect(second.context.messages).not.toContain(followUp);
		finish(second, assistant("steered reply"));

		const third = await nextCall();
		expect(third.context.messages).toContain(followUp);
		finish(third, assistant("follow-up reply"));

		await run;
	});

	test("aborts an active run and returns to idle", async () => {
		const abortedMessage: AssistantMessage = {
			...assistant(""),
			content: [],
			stopReason: "aborted",
			errorMessage: "aborted",
		};
		const provider: Provider = {
			id: "test",
			stream(_model, _context, options) {
				const stream = new AssistantMessageEventStream();
				const abort = () => {
					stream.push({
						type: "error",
						reason: "aborted",
						error: abortedMessage,
					});
				};

				if (options?.signal?.aborted) abort();
				else options?.signal?.addEventListener("abort", abort, { once: true });
				return stream;
			},
		};
		const agent = createAgent(provider);
		const run = agent.invoke(user("start"));

		agent.abort();
		const messages = await run;

		expect(messages.at(-1)).toBe(abortedMessage);
		expect(agent.getSession().isRunning).toBe(false);
		expect(agent.signal).toBeUndefined();
	});

	test("tracks pending tool calls while tools execute", async () => {
		const parameters = Type.Object({});
		const tool: AgentTool<typeof parameters> = {
			name: "read",
			description: "Read a file",
			parameters,
			async execute() {
				return {
					content: [{ type: "text", text: "contents" }],
				};
			},
		};
		const toolReply: AssistantMessage = {
			...assistant(""),
			content: [
				{
					type: "toolCall",
					id: "read-1",
					name: "read",
					arguments: {},
				},
			],
			stopReason: "toolUse",
		};
		const agent = createAgent(providerFor([toolReply, assistant("done")]), [tool]);
		let pendingAtStart = false;
		let pendingAtEnd = true;

		for await (const event of agent.stream(user("read"))) {
			if (event.type === "tool_execution_start") {
				pendingAtStart = agent.getSession().pendingToolCallIds.includes(event.toolCallId);
			}
			if (event.type === "tool_execution_end") {
				pendingAtEnd = agent.getSession().pendingToolCallIds.includes(event.toolCallId);
			}
		}

		expect(pendingAtStart).toBe(true);
		expect(pendingAtEnd).toBe(false);
	});

	test("waitForIdle resolves after the active invocation finishes", async () => {
		const { provider, nextCall } = createControlledProvider();
		const agent = createAgent(provider);
		const run = agent.invoke(user("start"));
		const call = await nextCall();

		let idle = false;
		const waiting = agent.waitForIdle().then(() => {
			idle = true;
		});
		await Promise.resolve();
		expect(idle).toBe(false);

		finish(call, assistant("done"));
		await run;
		await waiting;
		expect(idle).toBe(true);
	});

	test("returns only new messages without mutating the original context", async () => {
		const previous = user("previous");
		const originalContext = {
			systemPrompt: "You are helpful.",
			messages: [previous],
			tools: [] as AgentTool[],
		};
		const reply = assistant("done");
		const agent = new Agent({
			model,
			provider: providerFor([reply]),
			instructions: originalContext.systemPrompt,
			messages: originalContext.messages,
			tools: originalContext.tools,
		});
		const input = user("start");

		const messages = await agent.invoke(input);

		expect(messages).toEqual([input, reply]);
		expect(agent.getSession().messages).toEqual([previous, input, reply]);
		expect(originalContext.messages).toEqual([previous]);
	});

	test("accepts a string input", async () => {
		const contexts: Context[] = [];
		const agent = createAgent(providerFor([assistant("done")], contexts));

		const messages = await agent.invoke("hello");

		expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
		expect(contexts[0]?.messages[0]).toMatchObject({ role: "user", content: "hello" });
		expect(agent.getSession().messages[0]).toMatchObject({ role: "user", content: "hello" });
	});

	test("restores transcript from a Session without restoring transient run state", async () => {
		const previous = user("previous");
		const agent = new Agent({
			model,
			provider: providerFor([assistant("done")]),
			tools: [],
			session: {
				systemPrompt: "Restored instructions",
				messages: [previous],
				tools: [{ name: "old", description: "Old tool metadata" }],
				isRunning: true,
				pendingToolCallIds: ["stale-call"],
			},
		});

		const session = agent.getSession();

		expect(session.systemPrompt).toBe("Restored instructions");
		expect(session.messages).toEqual([previous]);
		expect(session.tools).toEqual([]);
		expect(session.isRunning).toBe(false);
		expect(session.pendingToolCallIds).toEqual([]);
	});

	test("reset clears transcript and preserves configuration", async () => {
		const agent = createAgent(providerFor([assistant("done")]));

		await agent.invoke(user("start"));
		agent.reset();

		expect(agent.getSession().messages).toEqual([]);
		expect(agent.getSession().systemPrompt).toBe("You are helpful.");
		expect(agent.getSession().tools).toEqual([]);
	});

	test("session and events survive JSON round-trip (wire-safe)", async () => {
		const parameters = Type.Object({});
		const tool: AgentTool<typeof parameters> = {
			name: "read",
			label: "Read File",
			description: "Read a file",
			parameters,
			async execute() {
				return {
					content: [{ type: "text", text: "contents" }],
					details: { path: "/a", lines: 1 },
				};
			},
		};
		const toolReply: AssistantMessage = {
			...assistant(""),
			content: [{ type: "toolCall", id: "read-1", name: "read", arguments: {} }],
			stopReason: "toolUse",
		};
		const agent = createAgent(providerFor([toolReply, assistant("done")]), [tool]);
		const events: AgentEvent[] = [];

		const run = agent.stream(user("read"));
		for await (const event of run) {
			events.push(event);
		}
		expect(await run.result()).toHaveLength(4);

		for (const event of events) {
			expect(JSON.parse(JSON.stringify(event))).toEqual(event);
		}

		const session = agent.getSession();
		expect(JSON.parse(JSON.stringify(session))).toEqual(session);
		expect(session.tools).toEqual([
			{ name: "read", label: "Read File", description: "Read a file" },
		]);
	});
});
