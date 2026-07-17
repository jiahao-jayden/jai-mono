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
import { Agent, type AgentTool } from "../src";

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
		context: {
			systemPrompt: "You are helpful.",
			messages: [],
			tools,
		},
		config: { model, provider },
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
	test("keeps the run active through agent_end listeners and finishes idle", async () => {
		const agent = createAgent(providerFor([assistant("done")]));
		let isRunningAtEnd: boolean | undefined;
		let signalAtStart: AbortSignal | undefined;

		agent.subscribe((event, signal) => {
			if (event.type === "agent_start") {
				signalAtStart = agent.signal;
				expect(agent.signal).toBe(signal);
			}
			if (event.type === "agent_end") {
				isRunningAtEnd = agent.state.isRunning;
			}
		});

		await agent.prompt(user("start"));

		expect(signalAtStart).toBeInstanceOf(AbortSignal);
		expect(isRunningAtEnd).toBe(true);
		expect(agent.state.isRunning).toBe(false);
		expect(agent.signal).toBeUndefined();
		expect(agent.state.pendingToolCallIds.size).toBe(0);
	});

	test("reduces each message lifecycle before notifying listeners", async () => {
		const agent = createAgent(providerFor([assistant("done")]));
		const statesAtMessageStart: Array<string | undefined> = [];

		agent.subscribe((event) => {
			if (event.type === "message_start") {
				statesAtMessageStart.push(agent.state.streamingMessage?.role);
			}
		});

		await agent.prompt(user("start"));

		expect(statesAtMessageStart).toEqual(["user", "assistant"]);
		expect(agent.state.streamingMessage).toBeUndefined();
		expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
	});

	test("recovers from listener failure without discarding queued messages", async () => {
		const contexts: Context[] = [];
		const agent = createAgent(
			providerFor([assistant("first reply"), assistant("second reply")], contexts),
		);
		const staleMessage = user("stale steering");
		let failListener = true;

		const unsubscribe = agent.subscribe((event) => {
			if (event.type === "agent_start" && failListener) {
				failListener = false;
				agent.steer(staleMessage);
				throw new Error("listener failed");
			}
		});

		await expect(agent.prompt(user("first"))).rejects.toThrow("listener failed");
		unsubscribe();
		await agent.prompt(user("second"));

		expect(contexts).toHaveLength(2);
		expect(contexts[1]?.messages).toContain(staleMessage);
		expect(agent.state.isRunning).toBe(false);
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

	test("rejects concurrent prompts", async () => {
		const stream = new AssistantMessageEventStream();
		const provider: Provider = {
			id: "test",
			stream() {
				return stream;
			},
		};
		const agent = createAgent(provider);
		const firstPrompt = agent.prompt(user("first"));

		await expect(agent.prompt(user("second"))).rejects.toThrow("Agent is already running");

		const reply = assistant("done");
		stream.push({ type: "start", partial: reply });
		stream.push({ type: "done", reason: "stop", message: reply });

		await firstPrompt;
		expect(agent.state.isRunning).toBe(false);
	});

	test("injects steering before follow-up through its internal queues", async () => {
		const { provider, nextCall } = createControlledProvider();
		const agent = createAgent(provider);
		const steering = user("steer");
		const followUp = user("follow up");
		const run = agent.prompt(user("start"));

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
		const run = agent.prompt(user("start"));

		agent.abort();
		const messages = await run;

		expect(messages.at(-1)).toBe(abortedMessage);
		expect(agent.state.isRunning).toBe(false);
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

		agent.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				pendingAtStart = agent.state.pendingToolCallIds.has(event.toolCallId);
			}
			if (event.type === "tool_execution_end") {
				pendingAtEnd = agent.state.pendingToolCallIds.has(event.toolCallId);
			}
		});

		await agent.prompt(user("read"));

		expect(pendingAtStart).toBe(true);
		expect(pendingAtEnd).toBe(false);
	});

	test("waitForIdle resolves after asynchronous listeners finish", async () => {
		const agent = createAgent(providerFor([assistant("done")]));
		let releaseListener = () => {};
		let markListenerStarted = () => {};
		const listenerStarted = new Promise<void>((resolve) => {
			markListenerStarted = resolve;
		});
		const listenerDone = new Promise<void>((resolve) => {
			releaseListener = resolve;
		});

		agent.subscribe(async (event) => {
			if (event.type === "agent_end") {
				markListenerStarted();
				await listenerDone;
			}
		});

		const run = agent.prompt(user("start"));
		await listenerStarted;

		let idle = false;
		const waiting = agent.waitForIdle().then(() => {
			idle = true;
		});
		await Promise.resolve();
		expect(idle).toBe(false);

		releaseListener();
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
			context: originalContext,
			config: { model, provider: providerFor([reply]) },
		});
		const prompt = user("start");

		const messages = await agent.prompt(prompt);

		expect(messages).toEqual([prompt, reply]);
		expect(agent.state.messages).toEqual([previous, prompt, reply]);
		expect(originalContext.messages).toEqual([previous]);
	});

	test("reset clears transcript and preserves configuration", async () => {
		const agent = createAgent(providerFor([assistant("done")]));

		await agent.prompt(user("start"));
		agent.reset();

		expect(agent.state.messages).toEqual([]);
		expect(agent.state.systemPrompt).toBe("You are helpful.");
		expect(agent.state.tools).toEqual([]);
	});
});
