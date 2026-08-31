import { describe, expect, test } from "bun:test";
import { zeroUsage } from "@jai/ai";
import { recoverOperation, recoverSessionOperations } from "../../../src/harness/operations";
import type { OperationRecord } from "../../../src/harness/operations";

const accepted = (operationId = "op-1", inputEntryId = "entry-user-1"): OperationRecord => ({
	type: "operation_accepted",
	operationId,
	kind: "prompt",
	inputEntryId,
	startLeafId: null,
	timestamp: "2026-08-25T00:00:00.000Z",
});

const attempted = (operationId = "op-1"): OperationRecord => ({
	type: "model_attempted",
	operationId,
	attemptId: "attempt-1",
	assistantEntryId: "entry-assistant-1",
	modelSnapshotId: "model-1",
	timestamp: "2026-08-25T00:00:01.000Z",
});

const settled = (operationId = "op-1"): OperationRecord => ({
	type: "usage_settled",
	operationId,
	attemptId: "attempt-1",
	usage: zeroUsage(),
	timestamp: "2026-08-25T00:00:02.000Z",
});

const dispatched = (operationId = "op-1"): OperationRecord => ({
	type: "tool_dispatched",
	operationId,
	toolCallId: "call-1",
	toolName: "Write",
	assistantEntryId: "entry-assistant-1",
	args: { path: "README.md", content: "hello" },
	argsHash: "hash-1",
	resultEntryId: "entry-result-1",
	timestamp: "2026-08-25T00:00:03.000Z",
});

const queuedInput = (operationId = "op-1"): OperationRecord => ({
	type: "input_queued",
	operationId,
	inputId: "input-1",
	delivery: "steer",
	inputEntryId: "entry-steer-1",
	text: "use the other approach",
	timestamp: "2026-08-25T00:00:03.000Z",
});

const finished = (operationId = "op-1", outcome: "completed" | "failed" | "aborted" | "blocked" = "completed"): OperationRecord => ({
	type: "operation_finished",
	operationId,
	outcome,
	timestamp: "2026-08-25T00:00:04.000Z",
});

function recover(
	records: readonly OperationRecord[],
	entryIds: readonly string[],
	terminalOutcomeByAssistantEntryId: ReadonlyMap<string, "completed" | "failed" | "aborted" | "blocked"> = new Map(),
) {
	return recoverOperation(records, { sessionEntryIds: new Set(entryIds), terminalOutcomeByAssistantEntryId });
}

describe("recoverOperation", () => {
	test("accepted prompt with no model attempt is ready", () => {
		const result = recover([accepted()], ["entry-user-1"]);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({ status: "ready", operationId: "op-1" });
	});

	test("an uncommitted model response is provider-interrupted", () => {
		const result = recover([accepted(), attempted(), settled()], ["entry-user-1"]);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			status: "provider_interrupted",
			operationId: "op-1",
			attemptId: "attempt-1",
		});
	});

	test("T1 without its Session Journal result is indeterminate and never a synthetic tool error", () => {
		const result = recover([accepted(), attempted(), settled(), dispatched()], ["entry-user-1", "entry-assistant-1"]);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			status: "indeterminate_tool",
			operationId: "op-1",
			dispatches: [
				{
					toolCallId: "call-1",
					toolName: "Write",
					resultEntryId: "entry-result-1",
				},
			],
		});
	});

	test("a durable tool result makes the operation ready to continue", () => {
		const result = recover(
			[accepted(), attempted(), settled(), dispatched()],
			["entry-user-1", "entry-assistant-1", "entry-result-1"],
		);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({ status: "ready", operationId: "op-1" });
	});

	test("replays only an accepted input whose reserved Session entry is still absent", () => {
		const pending = recover([accepted(), queuedInput()], ["entry-user-1"]);
		expect(pending.isOk()).toBe(true);
		if (pending.isErr()) throw pending.error;
		expect(pending.value).toEqual({
			status: "ready",
			operationId: "op-1",
			pendingInputs: [
				{
					inputId: "input-1",
					delivery: "steer",
					inputEntryId: "entry-steer-1",
					text: "use the other approach",
				},
			],
		});

		const consumed = recover([accepted(), queuedInput()], ["entry-user-1", "entry-steer-1"]);
		expect(consumed.isOk()).toBe(true);
		if (consumed.isErr()) throw consumed.error;
		expect(consumed.value).toEqual({ status: "ready", operationId: "op-1" });
	});

	test("terminal operations cannot be advanced again", () => {
		const records: OperationRecord[] = [
			accepted(),
			{
				type: "operation_finished",
				operationId: "op-1",
				outcome: "completed",
				timestamp: "2026-08-25T00:00:04.000Z",
			},
		];

		const result = recover(records, ["entry-user-1"]);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			status: "terminal",
			operationId: "op-1",
			outcome: "completed",
			finalization: "durable",
		});
	});

	test("infers a terminal outcome from the latest durable assistant result until the Host finalizes it", () => {
		const result = recover(
			[accepted(), attempted(), settled()],
			["entry-user-1", "entry-assistant-1"],
			new Map([["entry-assistant-1", "completed"]]),
		);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			status: "terminal",
			operationId: "op-1",
			outcome: "completed",
			finalization: "inferred",
		});
	});

	test("rejects a T1 that does not belong to a durable model response", () => {
		const result = recover([accepted(), dispatched()], ["entry-user-1"]);

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error("Expected corruption result");
		expect(result.error._tag).toBe("operations.corrupted_log");
	});
});

describe("recoverSessionOperations", () => {
	test("keeps per-operation recovery verdicts in durable acceptance order", () => {
		const verdict = recoverSessionOperations(
			[
				accepted("operation-1", "input-1"),
				finished("operation-1", "completed"),
				accepted("operation-2", "input-2"),
			],
			{
				sessionEntryIds: new Set(["input-1", "input-2"]),
				terminalOutcomeByAssistantEntryId: new Map(),
			},
		);

		expect(verdict.isOk()).toBe(true);
		if (verdict.isErr()) throw verdict.error;
		expect(verdict.value).toEqual([
			{ status: "terminal", operationId: "operation-1", outcome: "completed", finalization: "durable" },
			{ status: "ready", operationId: "operation-2" },
		]);
	});
});
