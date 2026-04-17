import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@jayden/jai-agent";
import { EventAdapter } from "../src/events/adapter.js";
import { AGUIEventType } from "../src/events/types.js";

function createAdapter() {
	return new EventAdapter("thread-1", "run-1");
}

describe("EventAdapter", () => {
	test("agent_start → RUN_STARTED", () => {
		const adapter = createAdapter();
		const events = adapter.translate({ type: "agent_start" });
		expect(events).toEqual([
			{ type: AGUIEventType.RUN_STARTED, threadId: "thread-1", runId: "run-1" },
		]);
	});

	test("agent_end → RUN_FINISHED (closes reasoning if open)", () => {
		const adapter = createAdapter();

		adapter.translate({ type: "stream", event: { type: "message_start" } });
		adapter.translate({ type: "stream", event: { type: "reasoning_delta", text: "think" } });

		const events = adapter.translate({ type: "agent_end", messages: [] });
		expect(events.length).toBe(2);
		expect(events[0].type).toBe(AGUIEventType.REASONING_END);
		expect(events[1]).toEqual({
			type: AGUIEventType.RUN_FINISHED,
			threadId: "thread-1",
			runId: "run-1",
		});
	});

	test("stream/message_start → TEXT_MESSAGE_START", () => {
		const adapter = createAdapter();
		const events = adapter.translate({ type: "stream", event: { type: "message_start" } });
		expect(events.length).toBe(1);
		expect(events[0].type).toBe(AGUIEventType.TEXT_MESSAGE_START);
		expect((events[0] as any).role).toBe("assistant");
	});

	test("stream/text_delta → TEXT_MESSAGE_CONTENT", () => {
		const adapter = createAdapter();
		adapter.translate({ type: "stream", event: { type: "message_start" } });

		const events = adapter.translate({
			type: "stream",
			event: { type: "text_delta", text: "hello" },
		});
		expect(events.length).toBe(1);
		expect(events[0].type).toBe(AGUIEventType.TEXT_MESSAGE_CONTENT);
		expect((events[0] as any).delta).toBe("hello");
	});

	test("stream/text_delta auto-creates messageId if no message_start", () => {
		const adapter = createAdapter();
		const events = adapter.translate({
			type: "stream",
			event: { type: "text_delta", text: "hi" },
		});
		expect(events.length).toBe(1);
		expect(events[0].type).toBe(AGUIEventType.TEXT_MESSAGE_CONTENT);
		expect((events[0] as any).messageId).toBeTruthy();
	});

	test("stream/message_end → TEXT_MESSAGE_END", () => {
		const adapter = createAdapter();
		adapter.translate({ type: "stream", event: { type: "message_start" } });

		const events = adapter.translate({
			type: "stream",
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					content: [],
					stopReason: "stop",
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					timestamp: Date.now(),
				},
			},
		});
		expect(events.length).toBe(1);
		expect(events[0].type).toBe(AGUIEventType.TEXT_MESSAGE_END);
	});

	test("stream/reasoning_delta → REASONING_START + REASONING_CONTENT (synthesized start)", () => {
		const adapter = createAdapter();
		adapter.translate({ type: "stream", event: { type: "message_start" } });

		const events = adapter.translate({
			type: "stream",
			event: { type: "reasoning_delta", text: "thinking..." },
		});
		expect(events.length).toBe(2);
		expect(events[0].type).toBe(AGUIEventType.REASONING_START);
		expect(events[1].type).toBe(AGUIEventType.REASONING_CONTENT);
		expect((events[1] as any).delta).toBe("thinking...");
	});

	test("consecutive reasoning_delta does not re-emit REASONING_START", () => {
		const adapter = createAdapter();
		adapter.translate({ type: "stream", event: { type: "message_start" } });
		adapter.translate({ type: "stream", event: { type: "reasoning_delta", text: "a" } });

		const events = adapter.translate({
			type: "stream",
			event: { type: "reasoning_delta", text: "b" },
		});
		expect(events.length).toBe(1);
		expect(events[0].type).toBe(AGUIEventType.REASONING_CONTENT);
	});

	test("reasoning → text transition closes reasoning", () => {
		const adapter = createAdapter();
		adapter.translate({ type: "stream", event: { type: "message_start" } });
		adapter.translate({ type: "stream", event: { type: "reasoning_delta", text: "think" } });

		const events = adapter.translate({
			type: "stream",
			event: { type: "text_delta", text: "output" },
		});
		expect(events.length).toBe(2);
		expect(events[0].type).toBe(AGUIEventType.REASONING_END);
		expect(events[1].type).toBe(AGUIEventType.TEXT_MESSAGE_CONTENT);
	});

	test("stream/error → RUN_ERROR", () => {
		const adapter = createAdapter();
		const events = adapter.translate({
			type: "stream",
			event: { type: "error", error: new Error("model timeout") },
		});
		expect(events.length).toBe(1);
		expect(events[0].type).toBe(AGUIEventType.RUN_ERROR);
		expect((events[0] as any).message).toBe("model timeout");
	});

	test("tool_start → TOOL_CALL_START + TOOL_CALL_ARGS", () => {
		const adapter = createAdapter();
		adapter.translate({ type: "stream", event: { type: "message_start" } });

		const events = adapter.translate({
			type: "tool_start",
			toolCallId: "tc-1",
			toolName: "bash",
			args: { command: "ls" },
		});
		expect(events.length).toBe(2);
		expect(events[0]).toEqual({
			type: AGUIEventType.TOOL_CALL_START,
			toolCallId: "tc-1",
			toolCallName: "bash",
			parentMessageId: expect.any(String),
		});
		expect(events[1]).toEqual({
			type: AGUIEventType.TOOL_CALL_ARGS,
			toolCallId: "tc-1",
			delta: '{"command":"ls"}',
		});
	});

	test("tool_end → TOOL_CALL_RESULT + TOOL_CALL_END", () => {
		const adapter = createAdapter();
		const events = adapter.translate({
			type: "tool_end",
			toolCallId: "tc-1",
			result: {
				content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
			},
		});
		expect(events.length).toBe(2);
		expect(events[0]).toEqual({
			type: AGUIEventType.TOOL_CALL_RESULT,
			toolCallId: "tc-1",
			content: "file1.txt\nfile2.txt",
		});
		expect(events[1]).toEqual({
			type: AGUIEventType.TOOL_CALL_END,
			toolCallId: "tc-1",
		});
	});

	test("turn_start, turn_end, message_end, tool_update produce no AG-UI events", () => {
		const adapter = createAdapter();
		const ignored: AgentEvent[] = [
			{ type: "turn_start" },
			{
				type: "turn_end",
				message: {
					role: "assistant",
					content: [],
					stopReason: "stop",
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					timestamp: Date.now(),
				},
				toolResults: [],
			},
			{
				type: "message_end",
				message: {
					role: "assistant",
					content: [],
					stopReason: "stop",
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
					timestamp: Date.now(),
				},
			},
			{
				type: "tool_update",
				toolCallId: "tc-1",
				partial: { content: [{ type: "text", text: "partial" }] },
			},
		];
		for (const event of ignored) {
			expect(adapter.translate(event)).toEqual([]);
		}
	});

	test("reasoning crash: agent_end synthesizes REASONING_END", () => {
		const adapter = createAdapter();
		adapter.translate({ type: "stream", event: { type: "message_start" } });
		adapter.translate({ type: "stream", event: { type: "reasoning_delta", text: "thinking" } });

		const events = adapter.translate({ type: "agent_end", messages: [] });
		const types = events.map((e) => e.type);
		expect(types).toContain(AGUIEventType.REASONING_END);
		expect(types).toContain(AGUIEventType.RUN_FINISHED);
	});

	// ── USAGE_UPDATE 语义：contextTokens = 最近一步的 inputTokens 快照 ──

	test("step_finish → USAGE_UPDATE with contextTokens = this step's inputTokens", () => {
		const adapter = createAdapter();
		const events = adapter.translate({
			type: "stream",
			event: {
				type: "step_finish",
				finishReason: "stop",
				usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
			},
		});
		expect(events.length).toBe(1);
		expect(events[0]).toEqual({
			type: AGUIEventType.USAGE_UPDATE,
			inputTokens: 1000,
			outputTokens: 200,
			contextTokens: 1000,
		});
	});

	test("multiple step_finish → contextTokens tracks LAST step (no accumulation)", () => {
		const adapter = createAdapter();

		const e1 = adapter.translate({
			type: "stream",
			event: {
				type: "step_finish",
				finishReason: "tool-calls",
				usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
			},
		});
		const e2 = adapter.translate({
			type: "stream",
			event: {
				type: "step_finish",
				finishReason: "tool-calls",
				usage: { inputTokens: 1500, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
			},
		});
		const e3 = adapter.translate({
			type: "stream",
			event: {
				type: "step_finish",
				finishReason: "stop",
				usage: { inputTokens: 3000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
			},
		});

		expect((e1[0] as any).contextTokens).toBe(1000);
		expect((e2[0] as any).contextTokens).toBe(1500);
		expect((e3[0] as any).contextTokens).toBe(3000);

		// getter: lastInputTokens 跟踪最后一步
		expect(adapter.lastInputTokens).toBe(3000);
		expect(adapter.lastOutputTokens).toBe(100);
		// stepTokensSum 仍然累加（用于 lifetime 统计）
		expect(adapter.stepTokensSum).toBe(1100 + 1600 + 3100);
	});

	test("step_finish after compaction → contextTokens drops", () => {
		const adapter = createAdapter();

		adapter.translate({
			type: "stream",
			event: {
				type: "step_finish",
				finishReason: "tool-calls",
				usage: { inputTokens: 150_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
			},
		});

		// compaction happens between turns; next step's input should be much smaller
		const afterCompact = adapter.translate({
			type: "stream",
			event: {
				type: "step_finish",
				finishReason: "stop",
				usage: { inputTokens: 20_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
			},
		});

		expect((afterCompact[0] as any).contextTokens).toBe(20_000);
		expect(adapter.lastInputTokens).toBe(20_000);
	});
});
