import { describe, expect, test } from "bun:test";
import { InMemoryOperationJournal } from "../../../src/harness/operations";
import type { OperationRecord } from "../../../src/harness/operations";

const accepted: OperationRecord = {
	type: "operation_accepted",
	operationId: "op-1",
	kind: "prompt",
	inputEntryId: "entry-user-1",
	startLeafId: null,
	timestamp: "2026-08-25T00:00:00.000Z",
};

describe("InMemoryOperationJournal", () => {
	test("keeps append-only records isolated by Session", async () => {
		const journal = new InMemoryOperationJournal();
		expect((await journal.create("session-a")).isOk()).toBe(true);
		expect((await journal.create("session-b")).isOk()).toBe(true);
		expect((await journal.append("session-a", accepted)).isOk()).toBe(true);

		const first = await journal.load("session-a");
		const second = await journal.load("session-b");
		if (first.isErr()) throw first.error;
		if (second.isErr()) throw second.error;
		expect(first.value).toEqual([accepted]);
		expect(second.value).toEqual([]);
	});

	test("rejects duplicate immutable record identities", async () => {
		const journal = new InMemoryOperationJournal();
		await journal.create("session-a");
		await journal.append("session-a", accepted);

		const result = await journal.append("session-a", accepted);

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error("Expected duplicate record result");
		expect(result.error._tag).toBe("operations.duplicate_record");
	});

	test("uses model-attempt identity for compact stream summaries", async () => {
		const journal = new InMemoryOperationJournal();
		await journal.create("session-a");
		const summary: OperationRecord = {
			type: "model_stream_settled",
			operationId: "op-1",
			turnId: "turn-1",
			attemptId: "attempt-1",
			assistantEntryId: "assistant-1",
			firstOutputAt: null,
			lastOutputAt: null,
			chunkCount: 0,
			chunkTypeCounts: { text_delta: 0, thinking_delta: 0, toolcall_delta: 0 },
			outcome: "failed",
			timestamp: "2026-08-25T00:00:01.000Z",
		};
		expect((await journal.append("session-a", summary)).isOk()).toBe(true);

		const duplicate = await journal.append("session-a", { ...summary, timestamp: "2026-08-25T00:00:02.000Z" });

		expect(duplicate.isErr()).toBe(true);
		if (duplicate.isOk()) throw new Error("Expected duplicate stream summary");
		expect(duplicate.error._tag).toBe("operations.duplicate_record");
	});

	test("reports an absent journal as a typed caller-handled failure", async () => {
		const result = await new InMemoryOperationJournal().load("missing");

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error("Expected missing journal result");
		expect(result.error._tag).toBe("operations.not_found");
	});
});
