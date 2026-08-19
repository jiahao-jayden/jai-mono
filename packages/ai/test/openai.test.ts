import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Type } from "@sinclair/typebox";
import type { StreamOptions } from "../src/provider";
import type { AssistantMessage, AssistantMessageEvent, Context, Model, Tool } from "../src/types";

let streamChunks: unknown[] = [];
let responseEvents: unknown[] = [];
let listedModels: unknown[] = [];
let capturedParams: any;
let capturedResponseParams: any;
let throwError: Error | undefined;

async function* gen(chunks: unknown[]): AsyncGenerator<unknown> {
	for (const c of chunks) yield c;
}

mock.module("openai", () => ({
	default: class MockOpenAI {
		chat = {
			completions: {
				create: async (params: unknown) => {
					capturedParams = params;
					if (throwError) throw throwError;
					return gen(streamChunks);
				},
			},
		};
		responses = {
			create: async (params: unknown) => {
				capturedResponseParams = params;
				if (throwError) throw throwError;
				return gen(responseEvents);
			},
		};
		models = {
			list: async () => {
				if (throwError) throw throwError;
				return { data: listedModels };
			},
		};
	},
}));

let OpenAIProvider: typeof import("../src/providers/openai").OpenAIProvider;
let OpenAIResponsesProvider: typeof import("../src/providers/openai-responses").OpenAIResponsesProvider;

beforeAll(async () => {
	({ OpenAIProvider } = await import("../src/providers/openai"));
	({ OpenAIResponsesProvider } = await import("../src/providers/openai-responses"));
});

beforeEach(() => {
	streamChunks = [];
	responseEvents = [];
	listedModels = [];
	capturedParams = undefined;
	capturedResponseParams = undefined;
	throwError = undefined;
});

function model(over: Partial<Model> = {}): Model {
	return {
		id: "gpt-5",
		name: "GPT-5",
		api: "openai-chat-completions",
		provider: "openai-compatible",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...over,
	};
}

function responsesModel(over: Partial<Model> = {}): Model {
	return model({
		api: "openai-responses",
		provider: "openai-responses",
		reasoning: true,
		...over,
	});
}

async function collect(
	context: Context,
	m: Model = model(),
	options?: StreamOptions,
): Promise<{ events: AssistantMessageEvent[]; message: any }> {
	const provider = new OpenAIProvider({ apiKey: "test" });
	const stream = provider.stream(m, context, options);
	const events: AssistantMessageEvent[] = [];
	for await (const e of stream) events.push(e);
	const message = await stream.result();
	return { events, message };
}

async function collectResponses(
	context: Context,
	m: Model = responsesModel(),
	options?: StreamOptions,
): Promise<{ events: AssistantMessageEvent[]; message: any }> {
	const provider = new OpenAIResponsesProvider({ apiKey: "test" });
	const stream = provider.stream(m, context, options);
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	const message = await stream.result();
	return { events, message };
}

const ctx = (over: Partial<Context> = {}): Context => ({
	systemPrompt: "",
	messages: [],
	tools: [],
	...over,
});

const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) => ({
	choices: [{ delta, finish_reason: finish }],
	...(usage ? { usage } : {}),
});

const readTool: Tool = {
	name: "read_file",
	description: "Read a file",
	parameters: Type.Object({ path: Type.String() }),
};

describe("OpenAIProvider · 出向翻译", () => {
	it("枚举 endpoint 模型 ID 并去重排序", async () => {
		listedModels = [{ id: "gpt-5" }, { id: "gpt-4.1" }, { id: "gpt-5" }];

		const provider = new OpenAIProvider({ apiKey: "test" });

		expect(await provider.listModels()).toEqual(["gpt-4.1", "gpt-5"]);
	});

	it("将 endpoint 枚举错误投影为安全领域错误", async () => {
		throwError = Object.assign(new Error("unauthorized"), { status: 401, requestID: "req-123" });
		const provider = new OpenAIProvider({ apiKey: "test" });

		await expect(provider.listModels()).rejects.toMatchObject({
			_tag: "ai_provider.model_discovery_failed",
			data: { adapter: "openai-compatible", status: 401, requestId: "req-123" },
		});
	});

	it("translates a text + tool_call stream into unified events", async () => {
		streamChunks = [
			chunk({ content: "Hi" }),
			chunk({ content: " there" }),
			chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"path":' } }] }),
			chunk({ tool_calls: [{ index: 0, function: { arguments: '"/x"}' } }] }),
			chunk({}, "tool_calls", { prompt_tokens: 10, completion_tokens: 5 }),
		];

		const { events, message } = await collect(ctx());
		const types = events.map((e) => e.type);

		expect(types).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);

		expect(message.content[0]).toEqual({ type: "text", text: "Hi there" });
		expect(message.content[1].type).toBe("toolCall");
		expect(message.content[1].name).toBe("read_file");
		expect(message.content[1].arguments).toEqual({ path: "/x" });
		expect(message.stopReason).toBe("toolUse");
		expect(message.usage.input).toBe(10);
		expect(message.usage.output).toBe(5);
	});

	it("rejects a complete XML text tool call when native tools are missing", async () => {
		streamChunks = [
			chunk({ content: '<invoke name="read_file"><parameter name="path">/x</parameter></invoke>' }),
			chunk({}, "stop"),
		];

		const { events, message } = await collect(ctx({ tools: [readTool] }));

		expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "error"]);
		expect(events.some((event) => event.type.startsWith("toolcall_"))).toBe(false);
		expect(message.stopReason).toBe("error");
		expect(message.error).toMatchObject({
			code: "ai.protocol_violation",
			type: "model_output_protocol",
		});
	});

	it("keeps XML examples and unknown tool names as ordinary text", async () => {
		streamChunks = [
			chunk({ content: '```xml\n<invoke name="read_file"><parameter name="path">/x</parameter></invoke>\n```' }),
			chunk({}, "stop"),
		];

		const fenced = await collect(ctx({ tools: [readTool] }));
		expect(fenced.message.stopReason).toBe("stop");

		streamChunks = [
			chunk({ content: '<invoke name="write_file"><parameter name="path">/x</parameter></invoke>' }),
			chunk({}, "stop"),
		];

		const unknown = await collect(ctx({ tools: [readTool] }));
		expect(unknown.message.stopReason).toBe("stop");

		streamChunks = [
			chunk({ content: 'Here is an XML example: <invoke name="read_file"><parameter name="path">/x</parameter></invoke>' }),
			chunk({}, "stop"),
		];

		const prose = await collect(ctx({ tools: [readTool] }));
		expect(prose.message.stopReason).toBe("stop");
	});

	it("prefers native tool calls when XML text is also present", async () => {
		streamChunks = [
			chunk({
				content: '<invoke name="read_file"><parameter name="path">/x</parameter></invoke>',
				tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"path":"/x"}' } }],
			}),
			chunk({}, "tool_calls"),
		];

		const { message } = await collect(ctx({ tools: [readTool] }));
		expect(message.stopReason).toBe("toolUse");
		expect(message.content.some((part: AssistantMessage["content"][number]) => part.type === "toolCall")).toBe(true);
	});

	it("recognizes the DSML function-call envelope without parsing its arguments", async () => {
		streamChunks = [
			chunk({
				content:
					'<｜DSML｜function_calls><｜DSML｜invoke name="read_file"><｜DSML｜parameter name="path">/x</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>',
			}),
			chunk({}, "stop"),
		];

		const { message } = await collect(ctx({ tools: [readTool] }));
		expect(message.stopReason).toBe("error");
		expect(message.error?.code).toBe("ai.protocol_violation");
	});

	it("sniffs reasoning_content into a thinking block when model.reasoning is true", async () => {
		streamChunks = [
			chunk({ reasoning_content: "thinking..." }),
			chunk({ content: "answer" }),
			chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1 }),
		];

		const { events, message } = await collect(ctx(), model({ reasoning: true }));
		expect(events.map((e) => e.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"done",
		]);
		expect(message.content[0]).toEqual({ type: "thinking", thinking: "thinking...", thinkingSignature: "reasoning_content" });
		expect(message.content[1]).toEqual({ type: "text", text: "answer" });
		expect(message.stopReason).toBe("stop");
	});

	it("closes a reasoning-only stream (no text, no tool call)", async () => {
		streamChunks = [
			chunk({ reasoning_content: "only reasoning" }),
			chunk({}, "length", { prompt_tokens: 1, completion_tokens: 1 }),
		];

		const { events, message } = await collect(ctx(), model({ reasoning: true }));
		expect(events.map((e) => e.type)).toEqual(["start", "thinking_start", "thinking_delta", "thinking_end", "done"]);
		expect(message.content[0].thinking).toBe("only reasoning");
		expect(message.stopReason).toBe("length");
	});

	it("emits an error event when the SDK call throws", async () => {
		throwError = Object.assign(new Error("maximum context exceeded"), {
			status: 400,
			code: "context_length_exceeded",
			type: "invalid_request_error",
			requestID: "req_openai",
		});
		const { events, message } = await collect(ctx());
		expect(events.at(-1)?.type).toBe("error");
		expect(message.stopReason).toBe("error");
		expect(message.error).toEqual({
			message: "maximum context exceeded",
			status: 400,
			code: "context_length_exceeded",
			type: "invalid_request_error",
			requestId: "req_openai",
		});
	});
});

describe("OpenAIProvider · 入向翻译", () => {
	it("prepends system prompt as a message and defaults to max_completion_tokens", async () => {
		streamChunks = [chunk({ content: "x" }), chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1 })];

		await collect(ctx({ systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 0 }] }));

		expect(capturedParams.model).toBe("gpt-5");
		expect(capturedParams.max_completion_tokens).toBe(4096);
		expect(capturedParams.max_tokens).toBeUndefined();
		expect(capturedParams.messages[0]).toEqual({ role: "system", content: "sys" });
		expect(capturedParams.messages[1]).toEqual({ role: "user", content: "hi" });
	});

	it("uses max_tokens when compatibility says so", async () => {
		streamChunks = [chunk({ content: "x" }), chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1 })];

		await collect(
			ctx({ messages: [{ role: "user", content: "hi", timestamp: 0 }] }),
			model({ compatibility: { maxTokensField: "max_tokens" } }),
		);

		expect(capturedParams.max_tokens).toBe(4096);
		expect(capturedParams.max_completion_tokens).toBeUndefined();
	});

	it("applies constrained provider options to the selected adapter", async () => {
		streamChunks = [chunk({ content: "x" }), chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1 })];

		await collect(ctx(), model(), {
			providerOptions: { "openai-compatible": { reasoning_effort: "high" }, other: { ignored: true } },
		});

		expect(capturedParams.reasoning_effort).toBe("high");
		expect(capturedParams.ignored).toBeUndefined();
	});
});

const responseUsage = {
	input_tokens: 12,
	output_tokens: 8,
	total_tokens: 20,
	input_tokens_details: { cached_tokens: 3 },
	output_tokens_details: { reasoning_tokens: 5 },
};

describe("OpenAIResponsesProvider", () => {
	it("streams reasoning summaries, function calls, and usage into unified events", async () => {
		responseEvents = [
			{
				type: "response.reasoning_summary_text.delta",
				item_id: "rs_1",
				output_index: 0,
				summary_index: 0,
				sequence_number: 1,
				delta: "Inspecting files",
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				sequence_number: 2,
				item: {
					type: "reasoning",
					id: "rs_1",
					summary: [{ type: "summary_text", text: "Inspecting files" }],
					encrypted_content: "encrypted-reasoning",
					status: "completed",
				},
			},
			{
				type: "response.output_item.added",
				output_index: 1,
				sequence_number: 3,
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "read_file",
					arguments: "",
					status: "in_progress",
				},
			},
			{
				type: "response.function_call_arguments.delta",
				item_id: "fc_1",
				output_index: 1,
				sequence_number: 4,
				delta: '{"path":"/x"}',
			},
			{
				type: "response.output_item.done",
				output_index: 1,
				sequence_number: 5,
				item: {
					type: "function_call",
					id: "fc_1",
					call_id: "call_1",
					name: "read_file",
					arguments: '{"path":"/x"}',
					status: "completed",
				},
			},
			{
				type: "response.completed",
				sequence_number: 6,
				response: { usage: responseUsage },
			},
		];

		const { events, message } = await collectResponses(ctx());

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(message.content[0]).toMatchObject({
			type: "thinking",
			thinking: "Inspecting files",
		});
		expect(message.content[0].thinkingSignature).toStartWith("openai-responses:");
		expect(message.content[1]).toEqual({
			type: "toolCall",
			id: "call_1",
			name: "read_file",
			arguments: { path: "/x" },
		});
		expect(message.stopReason).toBe("toolUse");
		expect(message.usage).toMatchObject({ input: 12, output: 8, cacheRead: 3, reasoning: 5, totalTokens: 20 });
	});

	it("builds stateless Responses input and restores encrypted reasoning items", async () => {
		responseEvents = [
			{
				type: "response.output_text.delta",
				item_id: "msg_1",
				output_index: 0,
				content_index: 0,
				sequence_number: 1,
				logprobs: [],
				delta: "done",
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				sequence_number: 2,
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "done", annotations: [], logprobs: [] }],
				},
			},
			{
				type: "response.completed",
				sequence_number: 3,
				response: { usage: responseUsage },
			},
		];
		const signature = `openai-responses:${JSON.stringify({
			id: "rs_previous",
			encryptedContent: "encrypted-previous",
		})}`;

		const { events, message } = await collectResponses(
			ctx({
				systemPrompt: "system",
				messages: [
					{ role: "user", content: "inspect", timestamp: 0 },
					{
						role: "assistant",
						provider: "openai-responses",
						model: "gpt-5",
						content: [
							{ type: "thinking", thinking: "Checked the file", thinkingSignature: signature },
							{ type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "/x" } },
						],
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "toolUse",
						timestamp: 0,
					},
					{
						role: "toolResult",
						toolCallId: "call_1",
						toolName: "read_file",
						content: [{ type: "text", text: "contents" }],
						isError: false,
						timestamp: 0,
					},
				],
			}),
			responsesModel(),
			{ providerOptions: { "openai-responses": { reasoning: { effort: "high", summary: "auto" } } } },
		);

		expect(capturedResponseParams).toMatchObject({
			model: "gpt-5",
			stream: true,
			store: false,
			include: ["reasoning.encrypted_content"],
			instructions: "system",
			max_output_tokens: 4096,
			reasoning: { effort: "high", summary: "auto" },
		});
		expect(capturedResponseParams.input).toEqual([
			{ type: "message", role: "user", content: "inspect" },
			{
				type: "reasoning",
				id: "rs_previous",
				summary: [{ type: "summary_text", text: "Checked the file" }],
				encrypted_content: "encrypted-previous",
			},
			{
				type: "function_call",
				call_id: "call_1",
				name: "read_file",
				arguments: '{"path":"/x"}',
			},
			{ type: "function_call_output", call_id: "call_1", output: "contents" },
		]);
		expect(events.map((event) => event.type)).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_end",
			"done",
		]);
		expect(message.content).toEqual([{ type: "text", text: "done" }]);
	});
});
