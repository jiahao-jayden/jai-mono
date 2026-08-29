import { describe, expect, test } from "bun:test";
import { type AssistantMessage, type Model, zeroUsage } from "@jai/ai";
import type { AgentTool } from "@jai/agent";
import { Type } from "@sinclair/typebox";
import { createOperationEffectBoundary } from "../../src/operations";
import { InMemoryProductSessionPersistence } from "../../src/sessions";

const model: Model = {
	id: "test-model",
	name: "Test model",
	api: "test",
	provider: "test",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
};

const toolParameters = Type.Object({ path: Type.String() });

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `id-${index}`;
}

function toolUsingAssistant(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call-1", name: "Read", arguments: { path: "notes.md" } }],
		provider: "test",
		model: model.id,
		usage: zeroUsage(),
		stopReason: "toolUse",
		timestamp: 0,
	};
}

describe("Operation effect boundary timing", () => {
	test("persists a compact turn, model stream, and tool timing summary without delta text", async () => {
		const persistence = new InMemoryProductSessionPersistence();
		const created = await persistence.create({
			id: "session-1",
			appState: {},
			runtimeConfiguration: { model: "test/test-model", mode: "manual" },
			cwd: "/workspace",
			createdAt: "2026-08-29T00:00:00.000Z",
		});
		if (created.isErr()) throw created.error;
		const admitted = await persistence.admitPrompt({
			sessionId: "session-1",
			inputEntry: {
				type: "message",
				id: "input-1",
				parentId: null,
				timestamp: "2026-08-29T00:00:00.000Z",
				message: { role: "user", content: "read notes", timestamp: 0 },
			},
			operation: {
				type: "operation_accepted",
				operationId: "operation-1",
				kind: "prompt",
				inputEntryId: "input-1",
				startLeafId: null,
				timestamp: "2026-08-29T00:00:00.000Z",
			},
		});
		if (admitted.isErr()) throw admitted.error;

		const boundary = createOperationEffectBoundary({
			sessionId: "session-1",
			operationId: "operation-1",
			persistence,
			createId: ids("turn-1", "attempt-1", "assistant-1", "tool-result-1"),
			now: () => new Date("2026-08-29T00:00:01.000Z"),
		});
		boundary.beginTurn();
		const reservation = await boundary.beforeModelEffect({ model, context: { systemPrompt: "", messages: [], tools: [] } });
		boundary.beginModelStream({ assistantEntryId: reservation.entryId });
		boundary.noteModelStreamChunk({ assistantEntryId: reservation.entryId, type: "text_delta" });
		boundary.noteModelStreamChunk({ assistantEntryId: reservation.entryId, type: "thinking_delta" });
		await boundary.afterModelEffect({ reservation, message: toolUsingAssistant() });
		boundary.finishModelStream({ assistantEntryId: reservation.entryId, outcome: "completed" });

		const beforeAssistant = await persistence.load("session-1");
		if (beforeAssistant.isErr()) throw beforeAssistant.error;
		const assistantAppended = await persistence.appendEntry({
			sessionId: "session-1",
			expectedRevision: beforeAssistant.value.revision,
			entry: {
				type: "message",
				id: reservation.entryId,
				parentId: "input-1",
				timestamp: "2026-08-29T00:00:01.000Z",
				message: toolUsingAssistant(),
			},
		});
		if (assistantAppended.isErr()) throw assistantAppended.error;
		const read: AgentTool<typeof toolParameters> = {
			name: "Read",
			description: "Read one file",
			parameters: toolParameters,
			async execute() {
				return { content: [] };
			},
		};
		await boundary.beforeToolEffect({
			toolCall: { type: "toolCall", id: "call-1", name: "Read", arguments: { path: "notes.md" } },
			tool: read,
			args: { path: "notes.md" },
		});
		boundary.finishTool({ toolCallId: "call-1", outcome: "completed" });
		boundary.finishTurn({ outcome: "completed" });
		await boundary.flushTiming();

		const durable = await persistence.load("session-1");
		if (durable.isErr()) throw durable.error;
		expect(durable.value.operationRecords).toMatchObject([
			{ type: "operation_accepted", operationId: "operation-1" },
			{ type: "turn_started", turnId: "turn-1" },
			{ type: "model_attempted", turnId: "turn-1", attemptId: "attempt-1", assistantEntryId: "assistant-1" },
			{ type: "usage_settled", attemptId: "attempt-1" },
			{
				type: "model_stream_settled",
				turnId: "turn-1",
				attemptId: "attempt-1",
				assistantEntryId: "assistant-1",
				chunkCount: 2,
				chunkTypeCounts: { text_delta: 1, thinking_delta: 1, toolcall_delta: 0 },
			},
			{ type: "tool_dispatched", turnId: "turn-1", toolCallId: "call-1", resultEntryId: "tool-result-1" },
			{ type: "tool_timing_settled", turnId: "turn-1", toolCallId: "call-1", outcome: "completed" },
			{ type: "turn_finished", turnId: "turn-1", assistantEntryId: "assistant-1", outcome: "completed" },
		]);
		expect(JSON.stringify(durable.value.operationRecords)).not.toContain("read notes");
	});
});
