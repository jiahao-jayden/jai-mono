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
import { agentLoop } from "../src/agent-loop";
import type {
	AgentContext,
	AgentEvent,
	AgentMessage,
	AgentTool,
} from "../src/types";

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
	events: AgentEvent[];
	messages: AgentMessage[];
}> {
	const events: AgentEvent[] = [];
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
		expect(events.map((event) => event.type)).toContain(
			"tool_execution_end",
		);
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

	test("closes normally with an aborted assistant message", async () => {
		const aborted = {
			...assistant([], "aborted"),
			errorMessage: "aborted",
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
			errorMessage: "provider crashed",
		});
	});
});
