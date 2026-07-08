import { describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { OpenAIProvider } from "../../src/providers/openai";
import type { AssistantMessageEvent, Context, Model } from "../../src/types";

// 真实模型集成测试。必须用独立进程跑（bun run test:e2e），
// 否则同进程里 test/*.test.ts 的 mock.module 会全局污染 SDK，导致这里拿到 mock 而非真实客户端。
const enabled = process.env.AI_E2E === "1";
const apiKey = process.env.OPENAI_API_KEY;

function model(): Model {
	return {
		id: process.env.OPENAI_TEST_MODEL ?? "gpt-4o-mini",
		name: "openai-e2e",
		api: "openai-chat-completions",
		provider: "openai-compatible",
		baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		// 小上限控制费用
		maxTokens: 128,
	};
}

function provider(): OpenAIProvider {
	return new OpenAIProvider({
		apiKey: apiKey ?? "",
		baseURL: process.env.OPENAI_BASE_URL,
	});
}

async function collect(context: Context): Promise<{ events: AssistantMessageEvent[]; message: any }> {
	const stream = provider().stream(model(), context);
	const events: AssistantMessageEvent[] = [];
	for await (const e of stream) events.push(e);
	const message = await stream.result();
	return { events, message };
}

describe.skipIf(!enabled || !apiKey)("OpenAIProvider · 真实模型", () => {
	it(
		"streams a real text reply with usage",
		async () => {
			const { events, message } = await collect({
				systemPrompt: "You are a terse assistant. Answer in one short word.",
				messages: [{ role: "user", content: "Reply with exactly: pong", timestamp: Date.now() }],
				tools: [],
			});

			const text = message.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("");

			expect(text.length).toBeGreaterThan(0);
			expect(message.stopReason).toBe("stop");
			expect(message.usage.input).toBeGreaterThan(0);
			expect(message.usage.output).toBeGreaterThan(0);
			expect(events.some((e) => e.type === "text_delta")).toBe(true);
			expect(events.at(-1)?.type).toBe("done");
		},
		30_000,
	);

	it(
		"calls a tool when instructed",
		async () => {
			const { message } = await collect({
				systemPrompt: "You are a weather assistant. Always call the get_weather tool, never answer directly.",
				messages: [{ role: "user", content: "What's the weather in Beijing?", timestamp: Date.now() }],
				tools: [
					{
						name: "get_weather",
						description: "Get the current weather for a city",
						parameters: Type.Object({ city: Type.String() }),
					},
				],
			});

			const toolCall = message.content.find((c: any) => c.type === "toolCall");
			expect(toolCall).toBeDefined();
			expect(toolCall.name).toBe("get_weather");
			expect(message.stopReason).toBe("toolUse");
		},
		30_000,
	);
});
