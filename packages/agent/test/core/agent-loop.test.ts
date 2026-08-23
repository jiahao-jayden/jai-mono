import { describe, expect, test } from "bun:test";
import {
	AssistantMessageEventStream,
	type AssistantMessage,
	type Context,
	type Model,
	type Provider,
	type ToolCall,
	type UserMessage,
	zeroUsage,
} from "@jai/ai";
import { Type } from "@sinclair/typebox";
import { agentLoop } from "../../src/core/agent-loop";
import type {
	AgentContext,
	AgentMessage,
	AgentTool,
	CoreAgentEvent,
} from "../../src/core/types";

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

function assistant(
	content: AssistantMessage["content"] = [],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function protocolError(): AssistantMessage {
	return {
		...assistant(
			[{ type: "text", text: '<invoke name="read"><parameter name="path">a.txt</parameter></invoke>' }],
			"error",
		),
		error: {
			message: "Model emitted a text-based tool call instead of a native tool call.",
			code: "ai.protocol_violation",
			type: "model_output_protocol",
		},
	};
}

function providerFor(
	responses: AssistantMessage[],
	contexts: Context[] = [],
): Provider {
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

function context(tools: AgentTool[] = []): AgentContext {
	return {
		systemPrompt: "You are helpful.",
		messages: [],
		tools,
	};
}

async function collect(stream: ReturnType<typeof agentLoop>): Promise<{
	events: CoreAgentEvent[];
	messages: AgentMessage[];
}> {
	const events: CoreAgentEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}

	return {
		events,
		messages: await stream.result(),
	};
}

describe("agentLoop", () => {
	test("runs one turn and returns only messages added by this run", async () => {
		const prompt = user("hello");
		const reply = assistant([{ type: "text", text: "hi" }]);
		const originalContext = context();

		const { events, messages } = await collect(
			agentLoop([prompt], originalContext, {
				model,
				provider: providerFor([reply]),
			}),
		);

		expect(events.map((event) => event.type)).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
		expect(messages).toEqual([prompt, reply]);
		expect(originalContext.messages).toEqual([]);
	});

	test("repairs a protocol-invalid response without persisting the invalid attempt", async () => {
		const toolParameters = Type.Object({ path: Type.String() });
		const calls: string[] = [];
		const readTool: AgentTool<typeof toolParameters> = {
			name: "read",
			description: "Read a file",
			parameters: toolParameters,
			async execute(_id, args) {
				calls.push(args.path);
				return { content: [{ type: "text", text: "contents" }] };
			},
		};
		const toolCall = assistant(
			[{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.txt" } }],
			"toolUse",
		);
		const final = assistant([{ type: "text", text: "done" }]);
		const contexts: Context[] = [];

		const { messages } = await collect(
			agentLoop([user("read a.txt")], context([readTool]), {
				model,
				provider: providerFor([protocolError(), toolCall, final], contexts),
			}),
		);

		expect(calls).toEqual(["a.txt"]);
		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(contexts[1]?.messages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", synthetic: true }],
		});
		expect(messages.some((message) => JSON.stringify(message).includes("<invoke"))).toBe(false);
	});

	test("keeps the agent turn recoverable when protocol repair also fails", async () => {
		const contexts: Context[] = [];
		const { events, messages } = await collect(
			agentLoop([user("read a.txt")], context(), {
				model,
				provider: providerFor([protocolError(), protocolError()], contexts),
			}),
		);

		expect(messages).toEqual([expect.objectContaining({ role: "user", content: "read a.txt" })]);
		expect(events.map((event) => event.type)).toEqual([
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
		expect(events.find((event) => event.type === "turn_end")).toMatchObject({
			message: {
				stopReason: "error",
				error: { code: "ai.protocol_violation" },
				content: [{ type: "text", text: expect.stringContaining("native tool-calling") }],
			},
		});
		expect(contexts[1]?.messages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", synthetic: true }],
		});
	});

	test("feeds tool results back to the provider in the next turn", async () => {
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-1",
			name: "read",
			arguments: { path: "a.txt" },
		};
		const first = assistant([toolCall], "toolUse");
		const final = assistant([{ type: "text", text: "done" }]);
		const contexts: Context[] = [];
		const calls: string[] = [];
		const readParameters = Type.Object({ path: Type.String() });
		const readTool: AgentTool<typeof readParameters> = {
			name: "read",
			description: "Read a file",
			parameters: readParameters,
			async execute(_id, args) {
				calls.push(args.path);
				return {
					content: [{ type: "text", text: "contents" }],
				};
			},
		};

		const { events, messages } = await collect(
			agentLoop([user("read a.txt")], context([readTool]), {
				model,
				provider: providerFor([first, final], contexts),
			}),
		);

		expect(calls).toEqual(["a.txt"]);
		expect(contexts).toHaveLength(2);
		expect(contexts[1]?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
		]);
		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(events.map((event) => event.type)).toContain(
			"tool_execution_start",
		);
		expect(events.find((event) => event.type === "tool_execution_start")).toMatchObject({
			toolName: "read",
			args: { path: "a.txt" },
		});
		expect(events.map((event) => event.type)).toContain(
			"tool_execution_end",
		);
	});

	test("keeps tool lifecycle events free of presentation metadata", async () => {
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-1",
			name: "act",
			arguments: { actionId: "demo.read" },
		};
		const actParameters = Type.Object({ actionId: Type.String() });
		const actTool: AgentTool<typeof actParameters> = {
			name: "act",
			description: "Run one action",
			parameters: actParameters,
			async execute() {
				return { content: [{ type: "text", text: "ok" }] };
			},
		};

		const { events, messages } = await collect(
			agentLoop([user("act")], context([actTool]), {
				model,
				provider: providerFor([assistant([toolCall], "toolUse"), assistant([{ type: "text", text: "done" }])], []),
			}),
		);

		for (const event of events.filter((event) => event.type.startsWith("tool_execution_"))) {
			expect(event).not.toHaveProperty("activityKind");
			expect(event).not.toHaveProperty("title");
		}
		expect(messages.find((message) => message.role === "toolResult")).toBeDefined();
	});

	test("发布流式增量时不等待整个响应结束", async () => {
		const message = assistant([{ type: "text", text: "hello world" }]);
		// The provider holds the stream open until the test releases it, so any
		// event observed before that release proves the loop is not buffering.
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const seen: string[] = [];
		const provider: Provider = {
			id: "test",
			stream() {
				const stream = new AssistantMessageEventStream();
				stream.push({ type: "start", partial: message });
				stream.push({
					type: "text_delta",
					contentIndex: 0,
					delta: "hello",
					partial: message,
				});
				void held.then(() => {
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		};

		const run = agentLoop([user("hi")], context(), { model, provider });
		for await (const event of run) {
			seen.push(event.type);
			if (event.type === "message_update") {
				// Arrived while the provider stream is still open.
				expect(seen).toContain("message_start");
				release();
			}
		}

		expect(seen).toContain("message_update");
	});

	test("丢弃已经流式发布过内容的尝试时发出撤回", async () => {
		// A provider that opens the stream, emits text, then fails the protocol
		// check — the case where the abandoned attempt is already on screen.
		const violation = protocolError();
		const recovered = assistant([{ type: "text", text: "done" }]);
		let call = 0;
		const provider: Provider = {
			id: "test",
			stream() {
				const stream = new AssistantMessageEventStream();
				if (call++ === 0) {
					stream.push({ type: "start", partial: violation });
					stream.push({
						type: "text_delta",
						contentIndex: 0,
						delta: "<invoke",
						partial: violation,
					});
					stream.push({ type: "error", reason: "error", error: violation });
				} else {
					stream.push({ type: "start", partial: recovered });
					stream.push({ type: "done", reason: "stop", message: recovered });
				}
				return stream;
			},
		};

		const { events } = await collect(
			agentLoop([user("read a.txt")], context(), { model, provider }),
		);

		const discardIndex = events.findIndex((event) => event.type === "message_discard");
		expect(discardIndex).toBeGreaterThan(-1);
		// Everything the abandoned attempt streamed comes before the discard.
		expect(events.slice(0, discardIndex).some((event) => event.type === "message_update")).toBe(true);
	});

	test("projects an interrupted tool call into a provider-safe context", async () => {
		const interrupted = assistant(
			[{ type: "toolCall", id: "call-interrupted", name: "read", arguments: { path: "a.txt" } }],
			"toolUse",
		);
		const contexts: Context[] = [];
		const initial = context();
		initial.messages = [interrupted, user("sent after interruption"), assistant([], "error")];

		await collect(
			agentLoop([user("continue")], initial, {
				model,
				provider: providerFor([assistant([{ type: "text", text: "recovered" }])], contexts),
			}),
		);

		expect(contexts[0]?.messages).toEqual([
			interrupted,
			expect.objectContaining({
				role: "toolResult",
				toolCallId: "call-interrupted",
				toolName: "read",
				isError: true,
			}),
			expect.objectContaining({ role: "user", content: "sent after interruption" }),
			expect.objectContaining({ role: "user", content: "continue" }),
		]);
	});

	test("turns a missing tool into an error result and continues", async () => {
		const first = assistant(
			[
				{
					type: "toolCall",
					id: "missing-1",
					name: "missing",
					arguments: {},
				},
			],
			"toolUse",
		);
		const final = assistant([{ type: "text", text: "recovered" }]);

		const { messages } = await collect(
			agentLoop([user("use missing")], context(), {
				model,
				provider: providerFor([first, final]),
			}),
		);

		const result = messages.find(
			(message) => message.role === "toolResult",
		);
		expect(result?.role).toBe("toolResult");
		if (result?.role === "toolResult") {
			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: "Tool missing not found",
			});
		}
	});

	test("stops after a terminating tool batch", async () => {
		const first = assistant(
			[
				{
					type: "toolCall",
					id: "finish-1",
					name: "finish",
					arguments: {},
				},
			],
			"toolUse",
		);
		const contexts: Context[] = [];
		const finishTool: AgentTool = {
			name: "finish",
			description: "Finish the run",
			parameters: Type.Object({}),
			async execute() {
				return {
					content: [{ type: "text", text: "finished" }],
					terminate: true,
				};
			},
		};

		const { messages } = await collect(
			agentLoop([user("finish")], context([finishTool]), {
				model,
				provider: providerFor([first], contexts),
			}),
		);

		expect(contexts).toHaveLength(1);
		expect(messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
		]);
	});

	test("executes parallel tools concurrently and publishes results in source order", async () => {
		const trace: string[] = [];
		const emptyParameters = Type.Object({});
		const createTool = (
			name: string,
		executionMode?: AgentTool["executionMode"],
		): AgentTool<typeof emptyParameters> => ({
			name,
			description: name,
			parameters: emptyParameters,
			executionMode,
			async execute() {
				trace.push(`${name}:start`);
				await Promise.resolve();
				trace.push(`${name}:end`);
				return {
					content: [{ type: "text", text: name }],
				};
			},
		});
		const contexts: Context[] = [];

		await collect(
			agentLoop(
				[user("run both")],
				context([createTool("a"), createTool("b")]),
				{
					model,
					provider: providerFor(
						[
							assistant(
								[
									{
										type: "toolCall",
										id: "a-1",
										name: "a",
										arguments: {},
									},
									{
										type: "toolCall",
										id: "b-1",
										name: "b",
										arguments: {},
									},
								],
								"toolUse",
							),
							assistant(),
						],
						contexts,
					),
				},
			),
		);

		expect(trace).toEqual(["a:start", "b:start", "a:end", "b:end"]);
		expect(
			contexts[1]?.messages
				.filter((message) => message.role === "toolResult")
				.map((message) => message.toolName),
		).toEqual(["a", "b"]);
	});

	test("falls back to sequential execution when one tool requires it", async () => {
		const trace: string[] = [];
		const emptyParameters = Type.Object({});
		const createTool = (
			name: string,
			executionMode?: AgentTool["executionMode"],
		): AgentTool<typeof emptyParameters> => ({
			name,
			description: name,
			parameters: emptyParameters,
			executionMode,
			async execute() {
				trace.push(`${name}:start`);
				await Promise.resolve();
				trace.push(`${name}:end`);
				return {
					content: [{ type: "text", text: name }],
					terminate: true,
				};
			},
		});

		await collect(
			agentLoop(
				[user("run in order")],
				context([
					createTool("read"),
					createTool("write", "sequential"),
				]),
				{
					model,
					provider: providerFor([
						assistant(
							[
								{
									type: "toolCall",
									id: "read-1",
									name: "read",
									arguments: {},
								},
								{
									type: "toolCall",
									id: "write-1",
									name: "write",
									arguments: {},
								},
							],
							"toolUse",
						),
					]),
				},
			),
		);

		expect(trace).toEqual([
			"read:start",
			"read:end",
			"write:start",
			"write:end",
		]);
	});

	test("turns validation and execute failures into tool result messages", async () => {
		const parameters = Type.Object({ value: Type.Number() });
		let executeCalls = 0;
		const failingTool: AgentTool<typeof parameters> = {
			name: "failing",
			description: "Fails",
			parameters,
			async execute() {
				executeCalls++;
				throw new Error("execute failed");
			},
		};

		const { messages } = await collect(
			agentLoop([user("try twice")], context([failingTool]), {
				model,
				provider: providerFor([
					assistant(
						[
							{
								type: "toolCall",
								id: "invalid-1",
								name: "failing",
								arguments: { value: "nope" },
							},
							{
								type: "toolCall",
								id: "throws-1",
								name: "failing",
								arguments: { value: 1 },
							},
						],
						"toolUse",
					),
					assistant(),
				]),
			}),
		);

		const results = messages.filter(
			(message) => message.role === "toolResult",
		);
		expect(executeCalls).toBe(1);
		expect(results).toHaveLength(2);
		expect(results.every((message) => message.isError)).toBe(true);
		expect(results[1]?.content[0]).toEqual({
			type: "text",
			text: "execute failed",
		});
	});

	test("composes tool middlewares around execution", async () => {
		const parameters = Type.Object({ value: Type.Number() });
		const seenValues: number[] = [];
		const tool: AgentTool<typeof parameters> = {
			name: "double",
			description: "Double a value",
			parameters,
			async execute(_id, args) {
				seenValues.push(args.value);
				return {
					content: [{ type: "text", text: String(args.value * 2) }],
				};
			},
		};

		const { messages } = await collect(
			agentLoop([user("double")], context([tool]), {
				model,
				provider: providerFor([
					assistant(
						[
							{
								type: "toolCall",
								id: "double-1",
								name: "double",
								arguments: { value: 1 },
							},
						],
						"toolUse",
					),
					assistant(),
				]),
				toolMiddlewares: [
					async (ctx, next) => {
						ctx.args.value = 2;
						const result = await next();
						return {
							...result,
							content: [
								...result.content,
								{ type: "text", text: "wrapped" },
							],
						};
					},
				],
			}),
		);

		const result = messages.find(
			(message) => message.role === "toolResult",
		);
		expect(seenValues).toEqual([2]);
		expect(result?.content).toEqual([
			{ type: "text", text: "4" },
			{ type: "text", text: "wrapped" },
		]);
	});

	test("re-validates arguments a middleware rewrote before calling the tool", async () => {
		const parameters = Type.Object({ value: Type.Number() });
		let executed = false;
		const tool: AgentTool<typeof parameters> = {
			name: "double",
			description: "Double a value",
			parameters,
			async execute() {
				executed = true;
				return { content: [] };
			},
		};

		const { messages } = await collect(
			agentLoop([user("double")], context([tool]), {
				model,
				provider: providerFor([
					assistant(
						[
							{
								type: "toolCall",
								id: "double-1",
								name: "double",
								arguments: { value: 1 },
							},
						],
						"toolUse",
					),
					assistant(),
				]),
				toolMiddlewares: [
					async (ctx, next) => {
						ctx.args.value = "not a number";
						return next();
					},
				],
			}),
		);

		const result = messages.find(
			(message) => message.role === "toolResult",
		);
		expect(executed).toBe(false);
		expect(result?.isError).toBe(true);
		expect(result?.content[0]).toMatchObject({
			text: expect.stringContaining("Validation failed"),
		});
	});

	test("injects steering before the next turn and follow-up after the task", async () => {
		const steering = user("keep the public API");
		const followUp = user("write a summary");
		const contexts: Context[] = [];
		const steeringBatches = [[], [steering], [], []];
		const followUpBatches = [[followUp], []];

		await collect(
			agentLoop([user("refactor auth")], context(), {
				model,
				provider: providerFor(
					[
						assistant([{ type: "text", text: "first" }]),
						assistant([{ type: "text", text: "adjusted" }]),
						assistant([{ type: "text", text: "summary" }]),
					],
					contexts,
				),
				getSteeringMessages: () => steeringBatches.shift() ?? [],
				getFollowUpMessages: () => followUpBatches.shift() ?? [],
			}),
		);

		expect(contexts).toHaveLength(3);
		expect(contexts[0]?.messages).not.toContain(steering);
		expect(contexts[1]?.messages).toContain(steering);
		expect(contexts[1]?.messages).not.toContain(followUp);
		expect(contexts[2]?.messages).toContain(followUp);
	});

	test("stops with an explicit message after reaching maxIterations", async () => {
		const { messages } = await collect(
			agentLoop([user("first task")], context(), {
				model,
				provider: providerFor([assistant([{ type: "text", text: "first reply" }])]),
				maxIterations: 1,
				getFollowUpMessages: () => [user("second task")],
			}),
		);

		expect(messages).toHaveLength(3);
		expect(messages.at(-1)).toMatchObject({
			role: "assistant",
			stopReason: "iterationLimit",
			content: [{ type: "text", text: expect.stringContaining("1-turn iteration limit") }],
		});
	});

	test("closes normally with an aborted assistant message", async () => {
		const aborted = {
			...assistant([], "aborted"),
			error: { message: "aborted" },
		};

		const { events, messages } = await collect(
			agentLoop([user("stop")], context(), {
				model,
				provider: providerFor([aborted]),
			}),
		);

		expect(events.at(-2)?.type).toBe("turn_end");
		expect(events.at(-1)?.type).toBe("agent_end");
		expect(messages.at(-1)).toBe(aborted);
	});

	test("converts unexpected driver errors into a terminal message", async () => {
		const provider: Provider = {
			id: "test",
			stream() {
				throw new Error("provider crashed");
			},
		};

		const { events, messages } = await collect(
			agentLoop([user("hello")], context(), { model, provider }),
		);

		expect(events.at(-2)?.type).toBe("turn_end");
		expect(events.at(-1)?.type).toBe("agent_end");
		expect(messages.at(-1)).toMatchObject({
			role: "assistant",
			stopReason: "error",
			error: { message: "provider crashed" },
		});
	});
});
