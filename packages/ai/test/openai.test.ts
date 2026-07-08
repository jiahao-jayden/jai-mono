import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AssistantMessageEvent, Context, Model } from "../src/types";

let streamChunks: unknown[] = [];
let capturedParams: any;
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
	},
}));

let OpenAIProvider: typeof import("../src/providers/openai").OpenAIProvider;

beforeAll(async () => {
	({ OpenAIProvider } = await import("../src/providers/openai"));
});

beforeEach(() => {
	streamChunks = [];
	capturedParams = undefined;
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

async function collect(context: Context, m: Model = model()): Promise<{ events: AssistantMessageEvent[]; message: any }> {
	const provider = new OpenAIProvider({ apiKey: "test" });
	const stream = provider.stream(m, context);
	const events: AssistantMessageEvent[] = [];
	for await (const e of stream) events.push(e);
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

describe("OpenAIProvider · 出向翻译", () => {
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
		throwError = new Error("kaboom");
		const { events, message } = await collect(ctx());
		expect(events.at(-1)?.type).toBe("error");
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe("kaboom");
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
});
