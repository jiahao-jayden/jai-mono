import { describe, expect, test } from "bun:test";
import {
	AssistantMessageEventStream,
	zeroUsage,
	type AssistantMessage,
	type Context,
	type Provider,
	type StreamOptions,
} from "@jai/ai";
import { compact, isContextOverflow, type CompactInput, type SessionEntry } from "../../../src/harness";
import { model } from "../../support/fixtures";

const settings = { reserveTokens: 1_000, tailTurns: 2, preserveRecentTokens: 200 };

function u(id: string, text: string): SessionEntry {
	return { type: "message", id, timestamp: id, message: { role: "user", content: text, timestamp: 0 } };
}

const entries: SessionEntry[] = [u("e0", "x".repeat(4_000)), u("e1", "y".repeat(4_000)), u("e2", "recent")];

interface Recorded {
	context: Context;
	options?: StreamOptions;
}

function summarizer(reply: Partial<AssistantMessage>, recorded: Recorded[] = []): Provider {
	return {
		id: "test",
		stream(_model, context, options) {
			recorded.push({ context, options });

			const message: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "SUMMARY" }],
				provider: "test",
				model: model.id,
				usage: { ...zeroUsage(), totalTokens: 42 },
				stopReason: "stop",
				timestamp: 0,
				...reply,
			};

			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial: message });
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				stream.push({ type: "error", reason: message.stopReason, error: message });
			} else {
				stream.push({ type: "done", reason: message.stopReason, message });
			}
			return stream;
		},
	};
}

function inputFor(provider: Provider, overrides: Partial<CompactInput> = {}): CompactInput {
	return {
		context: {
			systemPrompt: "identity",
			messages: (overrides.entries ?? entries).flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
			tools: [],
		},
		entries,
		model,
		settings,
		provider,
		trigger: "threshold",
		...overrides,
	};
}

describe("compact", () => {
	test("summarizes the head and reports a smaller projection", async () => {
		const result = await compact(inputFor(summarizer({})));

		expect(result.summary).toBe("SUMMARY");
		expect(result.firstKeptEntryId).toBe("e2");
		expect(result.usage.totalTokens).toBe(42);
		expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
	});

	test("asks the model without tools and inside the reserved budget", async () => {
		const recorded: Recorded[] = [];
		await compact(inputFor(summarizer({}, recorded)));

		expect(recorded[0]?.context.tools).toEqual([]);
		expect(recorded[0]?.options?.maxTokens).toBe(800);
	});

	test("feeds the previous summary in instead of replaying the whole session", async () => {
		const recorded: Recorded[] = [];
		await compact(
			inputFor(summarizer({}, recorded), {
				previous: {
					type: "compaction",
					id: "c0",
					timestamp: "2026-01-01T00:00:00.000Z",
					summary: "EARLIER",
					firstKeptEntryId: "e0",
					tokensBefore: 10,
					tokensAfter: 5,
					usage: zeroUsage(),
				},
			}),
		);

		const prompt = JSON.stringify(recorded[0]?.context.messages);
		expect(prompt).toContain("EARLIER");
		expect(prompt).toContain("previous-summary");
	});

	test("carries the caller's summary instructions", async () => {
		const recorded: Recorded[] = [];
		await compact(inputFor(summarizer({}, recorded), { summaryInstructions: "Keep every file path." }));

		expect(JSON.stringify(recorded[0]?.context.messages)).toContain("Keep every file path.");
	});

	test("caps a single tool result so it cannot eat the summary budget", async () => {
		const recorded: Recorded[] = [];
		const withToolResult: SessionEntry[] = [
			u("e0", "x".repeat(4_000)),
			{
				type: "message",
				id: "e1",
				timestamp: "e1",
				message: {
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "bash",
					content: [{ type: "text", text: "L".repeat(50_000) }],
					isError: false,
					timestamp: 0,
				},
			},
			u("e2", "recent"),
		];

		await compact(inputFor(summarizer({}, recorded), { entries: withToolResult }));

		const prompt = JSON.stringify(recorded[0]?.context.messages);
		expect(prompt).toContain("[truncated]");
		expect(prompt.length).toBeLessThan(10_000);
	});

	test("unserializable tool arguments do not break prompt assembly", async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const withToolCall: SessionEntry[] = [
			u("e0", "x".repeat(4_000)),
			{
				type: "message",
				id: "e1",
				timestamp: "e1",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: circular }],
					provider: "test",
					model: model.id,
					usage: zeroUsage(),
					stopReason: "toolUse",
					timestamp: 0,
				},
			},
			u("e2", "recent"),
		];

		const recorded: Recorded[] = [];
		const result = await compact(inputFor(summarizer({}, recorded), { entries: withToolCall }));

		expect(result.summary).toBe("SUMMARY");
		expect(JSON.stringify(recorded[0]?.context.messages)).toContain("[unserializable]");
	});

	test("refuses when there is nothing new to summarize", async () => {
		expect(compact(inputFor(summarizer({}), { entries: [u("e0", "only")] }))).rejects.toMatchObject({
			code: "nothing_to_compact",
		});
	});

	test("refuses an unusable summary response", async () => {
		const unusable: Partial<AssistantMessage>[] = [
			{ stopReason: "error" },
			{ stopReason: "contextOverflow" },
			{ content: [{ type: "text", text: "   " }] },
			{ content: [] },
		];

		for (const reply of unusable) {
			expect(compact(inputFor(summarizer(reply)))).rejects.toMatchObject({ code: "summarization_failed" });
		}
	});

	test("reports an aborted summary as aborted", async () => {
		expect(compact(inputFor(summarizer({ stopReason: "aborted" })))).rejects.toMatchObject({ code: "aborted" });
	});
});

describe("isContextOverflow", () => {
	const base: AssistantMessage = {
		role: "assistant",
		content: [],
		provider: "openai-compatible",
		model: model.id,
		usage: zeroUsage(),
		stopReason: "error",
		timestamp: 0,
	};

	test("matches the OpenAI family error code", () => {
		expect(isContextOverflow({ ...base, error: { message: "too long", code: "context_length_exceeded" } })).toBe(true);
	});

	test("matches Anthropic's fixed-shape 400", () => {
		expect(
			isContextOverflow({
				...base,
				provider: "anthropic",
				error: { message: "prompt is too long: 300000 tokens", status: 400, type: "invalid_request_error" },
			}),
		).toBe(true);
	});

	test("does not guess from vague failures", () => {
		const vague = [
			{ message: "413 Payload Too Large", status: 413 },
			{ message: "400 status code (no body)", status: 400 },
			{ message: "maximum context length is 8192", status: 400 },
		];

		for (const error of vague) {
			expect(isContextOverflow({ ...base, error })).toBe(false);
		}
	});

	test("a truncated but successful response is not an error path", () => {
		expect(isContextOverflow({ ...base, stopReason: "contextOverflow", error: undefined })).toBe(false);
	});
});
