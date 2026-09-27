import { describe, expect, test } from "bun:test";
import { branchOf, type BranchEntry, type MessageEntry, type OperationAccepted } from "@jai/agent";
import { SqliteProductSessionPersistence } from "../../src/persistence";
import { DatabaseSync } from "../../src/persistence/sqlite/driver";
import { InMemoryProductSessionPersistence, type ProductSessionPersistence } from "../../src/sessions";

const adapters: readonly (readonly [string, () => ProductSessionPersistence])[] = [
	["SqliteProductSessionPersistence", () => new SqliteProductSessionPersistence(new DatabaseSync(":memory:"))],
	["InMemoryProductSessionPersistence", () => new InMemoryProductSessionPersistence()],
];

const timestamp = "2026-09-26T00:00:00.000Z";

function input(id: string, parentId: string | null, content: string): MessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp,
		message: { role: "user", content, metadata: { acpV2Prompt: [{ type: "text", text: content }] }, timestamp: 0 },
	};
}

function accepted(operationId: string, entry: MessageEntry): OperationAccepted {
	return {
		type: "operation_accepted",
		operationId,
		kind: "prompt",
		inputEntryId: entry.id,
		startLeafId: entry.parentId,
		timestamp,
	};
}

function branch(id: string, parentId: string | null, fromId: string): BranchEntry {
	return { type: "branch", id, parentId, fromId, timestamp };
}

/** A Session whose only turn is `failed-input` at the root. */
async function sessionWithFailedFirstTurn(persistence: ProductSessionPersistence): Promise<void> {
	const created = await persistence.create({
		id: "session-1",
		appState: {},
		runtimeConfiguration: { model: "profile/model", permissionMode: "ask", interactionMode: "normal", fastMode: false },
		cwd: "/workspace",
		createdAt: timestamp,
	});
	if (created.isErr()) throw created.error;
	const failedInput = input("failed-input", null, "hi");
	const admitted = await persistence.admitPrompt({
		sessionId: "session-1",
		inputEntry: failedInput,
		operation: accepted("operation-1", failedInput),
	});
	if (admitted.isErr()) throw admitted.error;
	const finished = await persistence.appendOperation({
		sessionId: "session-1",
		record: {
			type: "operation_finished",
			operationId: "operation-1",
			outcome: "failed",
			timestamp,
			error: failureInfo,
		},
	});
	if (finished.isErr()) throw finished.error;
}

const failureInfo = { code: "coding_config.validation_failed", message: "Invalid coding configuration in /p/.jai/settings.json" };

for (const [name, open] of adapters) {
	describe(`${name} (retry admission contract)`, () => {
		test("commits a root branch entry, the re-admitted input and its Operation together", async () => {
			const persistence = open();
			await sessionWithFailedFirstTurn(persistence);
			const retryInput = input("retry-input", "retry-branch", "hi");

			const admitted = await persistence.admitPrompt({
				sessionId: "session-1",
				branch: branch("retry-branch", null, "failed-input"),
				inputEntry: retryInput,
				operation: accepted("operation-2", retryInput),
			});

			if (admitted.isErr()) throw admitted.error;
			const loaded = await persistence.load("session-1");
			if (loaded.isErr()) throw loaded.error;
			expect(loaded.value.snapshot.leafId).toBe("retry-input");
			expect(branchOf(loaded.value.snapshot.entries, "retry-input").map((entry) => entry.id)).toEqual([
				"retry-branch",
				"retry-input",
			]);
			expect(loaded.value.journalFacts.map((fact) => (fact.kind === "entry" ? fact.entry.id : fact.record.type))).toEqual(
				["failed-input", "operation_accepted", "operation_finished", "retry-branch", "retry-input", "operation_accepted"],
			);
			expect(loaded.value.operationRuntimeConfigurations.map((item) => item.operationId).sort()).toEqual([
				"operation-1",
				"operation-2",
			]);
			expect(loaded.value.operationRecords.find((record) => record.type === "operation_finished")).toMatchObject({
				error: failureInfo,
			});
		});

		test("rejects a branch that does not start from the current leaf", async () => {
			const persistence = open();
			await sessionWithFailedFirstTurn(persistence);
			const before = await persistence.load("session-1");
			if (before.isErr()) throw before.error;
			const retryInput = input("retry-input", "retry-branch", "hi");

			const admitted = await persistence.admitPrompt({
				sessionId: "session-1",
				branch: branch("retry-branch", null, "stale-leaf"),
				inputEntry: retryInput,
				operation: accepted("operation-2", retryInput),
			});

			expect(admitted.isErr() && admitted.error._tag).toBe("product_sessions.admission_conflict");
			const after = await persistence.load("session-1");
			if (after.isErr()) throw after.error;
			expect(after.value.revision).toBe(before.value.revision);
			expect(after.value.journalFacts).toEqual(before.value.journalFacts);
		});

		test("leaves no branch entry behind when the input entry cannot be written", async () => {
			const persistence = open();
			await sessionWithFailedFirstTurn(persistence);
			const before = await persistence.load("session-1");
			if (before.isErr()) throw before.error;
			// Reusing an existing entry id makes the second write of the transaction fail.
			const collidingInput = input("failed-input", "retry-branch", "hi");

			const admitted = await persistence.admitPrompt({
				sessionId: "session-1",
				branch: branch("retry-branch", null, "failed-input"),
				inputEntry: collidingInput,
				operation: accepted("operation-2", collidingInput),
			});

			expect(admitted.isErr() && admitted.error._tag).toBe("product_sessions.admission_conflict");
			const after = await persistence.load("session-1");
			if (after.isErr()) throw after.error;
			expect(after.value.snapshot.entries.map((entry) => entry.id)).toEqual(["failed-input"]);
			expect(after.value.snapshot.leafId).toBe("failed-input");
			expect(after.value.journalFacts).toEqual(before.value.journalFacts);
		});
	});
}
