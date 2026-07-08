import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AssistantMessageEvent, Context, Model } from "../src/types";

// mock SDK 的可变状态：每个用例设置流事件 / 捕获请求体 / 触发异常
let streamEvents: unknown[] = [];
let capturedParams: any;
let throwError: Error | undefined;

async function* gen(events: unknown[]): AsyncGenerator<unknown> {
	for (const e of events) yield e;
}

mock.module("@anthropic-ai/sdk", () => ({
	default: class MockAnthropic {
		messages = {
			create: async (params: unknown) => {
				capturedParams = params;
				if (throwError) throw throwError;
				return gen(streamEvents);
			},
		};
	},
}));

let AnthropicProvider: typeof import("../src/providers/anthropic").AnthropicProvider;

beforeAll(async () => {
	({ AnthropicProvider } = await import("../src/providers/anthropic"));
});

beforeEach(() => {
	streamEvents = [];
	capturedParams = undefined;
	throwError = undefined;
});

function model(): Model {
	return {
		id: "claude-opus-4-8",
		name: "Claude Opus",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
	};
}

async function collect(context: Context): Promise<{ events: AssistantMessageEvent[]; message: any }> {
	const provider = new AnthropicProvider({ apiKey: "test" });
	const stream = provider.stream(model(), context);
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

describe("AnthropicProvider · 出向翻译", () => {
	it("translates a text + tool_use stream into unified events", async () => {
		streamEvents = [
			{ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 5 } } },
			{ type: "content_block_start", index: 0, content_block: { type: "text" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "read_file" } },
			{ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":' } },
			{ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"/x"}' } },
			{ type: "content_block_stop", index: 1 },
			{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
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

		expect(message.content).toHaveLength(2);
		expect(message.content[0]).toEqual({ type: "text", text: "Hello world" });
		expect(message.content[1].type).toBe("toolCall");
		expect(message.content[1].name).toBe("read_file");
		expect(message.content[1].arguments).toEqual({ path: "/x" });
		expect(message.stopReason).toBe("toolUse");
	});

	it("accumulates thinking with signature", async () => {
		streamEvents = [
			{ type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 0 } } },
			{ type: "content_block_start", index: 0, content_block: { type: "thinking" } },
			{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } },
			{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-abc" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } },
		];

		const { events, message } = await collect(ctx());
		expect(events.map((e) => e.type)).toEqual(["start", "thinking_start", "thinking_delta", "thinking_end", "done"]);
		expect(message.content[0]).toEqual({ type: "thinking", thinking: "let me think", thinkingSignature: "sig-abc" });
		expect(message.stopReason).toBe("stop");
	});

	it("reports inclusive input usage (input + cache)", async () => {
		streamEvents = [
			{
				type: "message_start",
				message: { usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 } },
			},
			{ type: "content_block_start", index: 0, content_block: { type: "text" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
		];

		const { message } = await collect(ctx());
		expect(message.usage.input).toBe(150);
		expect(message.usage.cacheRead).toBe(20);
		expect(message.usage.cacheWrite).toBe(30);
		expect(message.usage.output).toBe(5);
		expect(message.usage.totalTokens).toBe(155);
	});

	it("emits an error event when the SDK call throws", async () => {
		throwError = new Error("boom");
		const { events, message } = await collect(ctx());
		expect(events.at(-1)?.type).toBe("error");
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe("boom");
	});
});

describe("AnthropicProvider · 入向翻译", () => {
	it("puts system prompt at top level with a cache breakpoint", async () => {
		streamEvents = [
			{ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
		];

		await collect(ctx({ systemPrompt: "You are helpful", messages: [{ role: "user", content: "hi", timestamp: 0 }] }));

		expect(capturedParams.model).toBe("claude-opus-4-8");
		expect(capturedParams.max_tokens).toBe(4096);
		expect(capturedParams.system[0]).toEqual({
			type: "text",
			text: "You are helpful",
			cache_control: { type: "ephemeral" },
		});
		expect(capturedParams.messages).toEqual([{ role: "user", content: "hi" }]);
	});

	it("marks the last tool definition with a cache breakpoint", async () => {
		streamEvents = [
			{ type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
		];

		await collect(
			ctx({
				messages: [{ role: "user", content: "hi", timestamp: 0 }],
				tools: [
					{ name: "a", description: "tool a", parameters: { type: "object", properties: {} } as any },
					{ name: "b", description: "tool b", parameters: { type: "object", properties: {} } as any },
				],
			}),
		);

		expect(capturedParams.tools).toHaveLength(2);
		expect(capturedParams.tools[0].cache_control).toBeUndefined();
		expect(capturedParams.tools[1].cache_control).toEqual({ type: "ephemeral" });
	});
});
