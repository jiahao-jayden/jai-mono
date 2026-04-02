import { describe, expect, test } from "bun:test";
import { resolveModelInfo } from "../src/models.js";
import type {
	AssistantMessage,
	Message,
	ModelInfo,
	ResolvedModel,
	StreamMessageInput,
} from "../src/types.js";

// ── resolveModelInfo → streamMessage input ───────────────────
// Tests the full model resolution path that streamMessage uses internally

describe("model resolution for streaming", () => {
	test("string model ID resolves to valid ResolvedModel", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");

		expect(m.config.provider).toBe("anthropic");
		expect(m.config.model).toBe("claude-sonnet-4-20250514");
		expect(m.capabilities.toolCall).toBe(true);
		expect(m.capabilities.reasoning).toBe(true);
		expect(m.npm).toBe("@ai-sdk/anthropic");
		expect(m.providerId).toBe("anthropic");
	});

	test("ResolvedModel includes all fields needed by ProviderTransform", () => {
		const m = resolveModelInfo("openai/gpt-4o");

		expect(m.id).toBe("openai/gpt-4o");
		expect(m.providerId).toBeDefined();
		expect(m.npm).toBeDefined();
		expect(m.apiModelId).toBeDefined();
		expect(m.config).toBeDefined();
		expect(m.capabilities).toBeDefined();
		expect(m.limit).toBeDefined();
	});
});

// ── Message type correctness ─────────────────────────────────

describe("message types", () => {
	test("UserMessage is valid", () => {
		const msg: Message = {
			role: "user",
			content: [{ type: "text", text: "Hello" }],
			timestamp: Date.now(),
		};
		expect(msg.role).toBe("user");
		expect(msg.content[0].type).toBe("text");
	});

	test("UserMessage with image is valid", () => {
		const msg: Message = {
			role: "user",
			content: [
				{ type: "text", text: "What's in this image?" },
				{
					type: "image",
					url: "https://example.com/img.png",
					mimeType: "image/png",
				},
			],
			timestamp: Date.now(),
		};
		expect(msg.content.length).toBe(2);
	});

	test("AssistantMessage with tool call is valid", () => {
		const msg: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "Let me search for that." },
				{
					type: "tool_call",
					toolCallId: "call_123",
					toolName: "search",
					input: { query: "test" },
				},
			],
			stopReason: "tool_calls",
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			timestamp: Date.now(),
		};
		expect(msg.stopReason).toBe("tool_calls");
		expect(msg.content.length).toBe(2);
	});

	test("AssistantMessage with thinking is valid", () => {
		const msg: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", text: "Let me think about this..." },
				{ type: "text", text: "The answer is 42." },
			],
			stopReason: "stop",
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			timestamp: Date.now(),
		};
		expect(msg.content[0].type).toBe("thinking");
	});

	test("ToolResultMessage is valid", () => {
		const msg: Message = {
			role: "tool_result",
			toolCallId: "call_123",
			toolName: "search",
			content: [{ type: "text", text: "Found 5 results" }],
			isError: false,
			timestamp: Date.now(),
		};
		expect(msg.role).toBe("tool_result");
	});
});

// ── StreamMessageInput validation ────────────────────────────

describe("StreamMessageInput", () => {
	test("accepts string model", () => {
		const input: StreamMessageInput = {
			model: "anthropic/claude-sonnet-4-20250514",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Hi" }],
					timestamp: Date.now(),
				},
			],
		};
		expect(typeof input.model).toBe("string");
	});

	test("accepts ModelInfo object", () => {
		const modelInfo: ModelInfo = {
			config: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "sk-test",
			},
			capabilities: {
				reasoning: true,
				toolCall: true,
				structuredOutput: false,
				input: {
					text: true,
					image: true,
					audio: false,
					video: false,
					pdf: true,
				},
				output: { text: true, image: false },
			},
			limit: { context: 200000, output: 64000 },
		};
		const input: StreamMessageInput = {
			model: modelInfo,
			messages: [],
		};
		expect(typeof input.model).toBe("object");
	});

	test("accepts optional fields", () => {
		const input: StreamMessageInput = {
			model: "openai/gpt-4o",
			messages: [],
			systemPrompt: "You are helpful.",
			maxRetries: 3,
			apiKey: "sk-override",
			baseURL: "https://custom.api.com",
			sessionId: "session-123",
		};
		expect(input.systemPrompt).toBe("You are helpful.");
		expect(input.sessionId).toBe("session-123");
	});
});

// ── ResolvedModel backward compat ────────────────────────────
// When users pass a ModelInfo (not string), stream.ts converts it
// via toResolvedModel. Test that the shape is correct.

describe("ModelInfo → ResolvedModel mapping", () => {
	test("anthropic provider maps to correct npm", () => {
		const m = resolveModelInfo("anthropic/claude-sonnet-4-20250514");
		expect(m.npm).toBe("@ai-sdk/anthropic");
	});

	test("openai provider maps to correct npm", () => {
		const m = resolveModelInfo("openai/gpt-4o");
		expect(m.npm).toBe("@ai-sdk/openai");
	});

	test("google provider maps to correct npm", async () => {
		const { listModels } = await import("../src/models.js");
		const models = listModels("google");
		if (models.length === 0) return;
		const m = resolveModelInfo(`google/${models[0]}`);
		expect(m.npm).toBe("@ai-sdk/google");
	});
});

// ── Usage type ───────────────────────────────────────────────

describe("Usage type", () => {
	test("has all required fields", () => {
		const usage = {
			inputTokens: 100,
			outputTokens: 50,
			cacheReadTokens: 20,
			cacheWriteTokens: 10,
		};
		expect(usage.inputTokens + usage.outputTokens).toBe(150);
		expect(usage.cacheReadTokens).toBe(20);
		expect(usage.cacheWriteTokens).toBe(10);
	});
});

// ── Multi-turn conversation structure ────────────────────────

describe("multi-turn conversation", () => {
	test("typical tool-use conversation has correct structure", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Search for TypeScript" }],
				timestamp: 1000,
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll search for that." },
					{
						type: "tool_call",
						toolCallId: "call_1",
						toolName: "search",
						input: { query: "TypeScript" },
					},
				],
				stopReason: "tool_calls",
				usage: {
					inputTokens: 50,
					outputTokens: 30,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
				timestamp: 2000,
			},
			{
				role: "tool_result",
				toolCallId: "call_1",
				toolName: "search",
				content: [
					{
						type: "text",
						text: "TypeScript is a typed superset of JavaScript.",
					},
				],
				isError: false,
				timestamp: 3000,
			},
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "TypeScript is a typed superset of JavaScript.",
					},
				],
				stopReason: "stop",
				usage: {
					inputTokens: 100,
					outputTokens: 40,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
				timestamp: 4000,
			},
		];

		expect(messages).toHaveLength(4);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");
		expect(messages[2].role).toBe("tool_result");
		expect(messages[3].role).toBe("assistant");

		const toolCall = messages[1] as AssistantMessage;
		const toolResult = messages[2];
		if (toolResult.role === "tool_result") {
			expect(toolResult.toolCallId).toBe("call_1");
		}
		const tc = toolCall.content.find((b) => b.type === "tool_call");
		if (tc && tc.type === "tool_call") {
			expect(tc.toolCallId).toBe("call_1");
		}
	});
});
