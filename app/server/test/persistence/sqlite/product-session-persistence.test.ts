import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeHost } from "../../../src/runtime";
import { SqliteProductSessionPersistence } from "../../../src/persistence";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `id-${index}`;
}

describe("SqliteProductSessionPersistence", () => {
	test("commits the Session input and operation admission together and recovers them after reopening", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-runtime-host-"));
		temporaryDirectories.push(root);
		const databasePath = join(root, "data.sqlite");
		const persistence = await SqliteProductSessionPersistence.open(databasePath);
		const host = new RuntimeHost({
			persistence,
			createId: ids("session-1", "operation-1"),
			now: () => new Date("2026-08-25T10:00:00.000Z"),
		});
		const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
		if (opened.isErr()) throw opened.error;
		const admitted = await opened.value.prompt({ text: "make this durable" });
		if (admitted.isErr()) throw admitted.error;
		persistence.close();

		const reopened = await SqliteProductSessionPersistence.open(databasePath);
		const loaded = await reopened.load("session-1");
		if (loaded.isErr()) throw loaded.error;
		expect(loaded.value.snapshot.entries).toMatchObject([
			{
				id: "operation-1:input",
				parentId: null,
				message: { role: "user", content: "make this durable" },
			},
		]);
		expect(loaded.value.operationRecords).toEqual([
			{
				type: "operation_accepted",
				operationId: "operation-1",
				kind: "prompt",
				inputEntryId: "operation-1:input",
				startLeafId: null,
				timestamp: "2026-08-25T10:00:00.000Z",
			},
		]);
		reopened.close();
	});

	test("rejects a stale prompt without recording either half of the admission", async () => {
		const persistence = new SqliteProductSessionPersistence(new (await import("node:sqlite")).DatabaseSync(":memory:"));
		const host = new RuntimeHost({
			persistence,
			createId: ids("session-1", "operation-1", "operation-2"),
		});
		const opened = await host.openSession({ kind: "new", cwd: "/workspace" });
		if (opened.isErr()) throw opened.error;
		const first = await opened.value.prompt({ text: "first" });
		if (first.isErr()) throw first.error;

		const stale = await persistence.admitPrompt({
			sessionId: "session-1",
			inputEntry: {
				type: "message",
				id: "stale-input",
				parentId: null,
				timestamp: "2026-08-25T10:00:00.000Z",
				message: { role: "user", content: "stale", timestamp: Date.parse("2026-08-25T10:00:00.000Z") },
			},
			operation: {
				type: "operation_accepted",
				operationId: "operation-2",
				kind: "prompt",
				inputEntryId: "stale-input",
				startLeafId: null,
				timestamp: "2026-08-25T10:00:00.000Z",
			},
		});

		expect(stale.isErr()).toBe(true);
		const loaded = await persistence.load("session-1");
		if (loaded.isErr()) throw loaded.error;
		expect(loaded.value.snapshot.entries.map((entry) => entry.id)).toEqual(["operation-1:input"]);
		expect(loaded.value.operationRecords.map((record) => record.operationId)).toEqual(["operation-1"]);
	});

	test("keeps an append-only Session configuration history and binds an accepted Operation to its current fact", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-runtime-host-configuration-"));
		temporaryDirectories.push(root);
		const databasePath = join(root, "data.sqlite");
		const persistence = await SqliteProductSessionPersistence.open(databasePath);
		const created = await persistence.create({
			id: "session-1",
			appState: {},
			runtimeConfiguration: { model: "profile/model-a", mode: "manual" },
			cwd: "/workspace",
			createdAt: "2026-08-25T10:00:00.000Z",
		});
		if (created.isErr()) throw created.error;
		const configured = await persistence.appendRuntimeConfiguration({
			sessionId: "session-1",
			configuration: { model: "profile/model-b", mode: "plan" },
			timestamp: "2026-08-25T10:01:00.000Z",
		});
		if (configured.isErr()) throw configured.error;
		const admitted = await persistence.admitPrompt({
			sessionId: "session-1",
			inputEntry: {
				type: "message",
				id: "operation-1:input",
				parentId: null,
				timestamp: "2026-08-25T10:02:00.000Z",
				message: { role: "user", content: "use the selected model", timestamp: Date.parse("2026-08-25T10:02:00.000Z") },
			},
			operation: {
				type: "operation_accepted",
				operationId: "operation-1",
				kind: "prompt",
				inputEntryId: "operation-1:input",
				startLeafId: null,
				timestamp: "2026-08-25T10:02:00.000Z",
			},
		});
		if (admitted.isErr()) throw admitted.error;
		persistence.close();

		const reopened = await SqliteProductSessionPersistence.open(databasePath);
		const loaded = await reopened.load("session-1");
		if (loaded.isErr()) throw loaded.error;
		expect(loaded.value.runtimeConfiguration).toEqual({ model: "profile/model-b", mode: "plan" });
		expect(loaded.value.operationRuntimeConfigurations).toEqual([
			{
				operationId: "operation-1",
				configuration: { model: "profile/model-b", mode: "plan" },
			},
		]);
		reopened.close();
	});

	test("does not project leftover product_session_catalog.title into Product Session info", async () => {
		const { DatabaseSync } = await import("node:sqlite");
		const database = new DatabaseSync(":memory:");
		const persistence = new SqliteProductSessionPersistence(database);
		const created = await persistence.create({
			id: "session-1",
			appState: {},
			runtimeConfiguration: { model: "profile/model-a", mode: "manual" },
			cwd: "/workspace",
			createdAt: "2026-08-25T10:00:00.000Z",
		});
		if (created.isErr()) throw created.error;
		database.prepare("UPDATE product_session_catalog SET title = ? WHERE session_id = ?").run("Leftover title", "session-1");

		const listed = await persistence.list();
		if (listed.isErr()) throw listed.error;
		expect(listed.value).toEqual([{ id: "session-1", cwd: "/workspace", updatedAt: "2026-08-25T10:00:00.000Z" }]);
		expect(listed.value[0]).not.toHaveProperty("title");

		const loaded = await persistence.load("session-1");
		if (loaded.isErr()) throw loaded.error;
		expect(loaded.value).not.toHaveProperty("title");
	});

	test("keeps the Session Journal when an Operation record is no longer a current fact", async () => {
		const { DatabaseSync } = await import("node:sqlite");
		const database = new DatabaseSync(":memory:");
		const persistence = new SqliteProductSessionPersistence(database);
		const created = await persistence.create({
			id: "session-1",
			appState: {},
			runtimeConfiguration: { model: "profile/model", mode: "manual" },
			cwd: "/workspace",
			createdAt: "2026-08-25T10:00:00.000Z",
		});
		if (created.isErr()) throw created.error;
		const admitted = await persistence.admitPrompt({
			sessionId: "session-1",
			inputEntry: {
				type: "message",
				id: "operation-1:input",
				parentId: null,
				timestamp: "2026-08-25T10:00:01.000Z",
				message: { role: "user", content: "你好", timestamp: Date.parse("2026-08-25T10:00:01.000Z") },
			},
			operation: {
				type: "operation_accepted",
				operationId: "operation-1",
				kind: "prompt",
				inputEntryId: "operation-1:input",
				startLeafId: null,
				timestamp: "2026-08-25T10:00:01.000Z",
			},
		});
		if (admitted.isErr()) throw admitted.error;
		const afterAdmit = await persistence.load("session-1");
		if (afterAdmit.isErr()) throw afterAdmit.error;
		const appended = await persistence.appendEntry({
			sessionId: "session-1",
			expectedRevision: afterAdmit.value.revision,
			entry: {
				type: "message",
				id: "assistant-1",
				parentId: "operation-1:input",
				timestamp: "2026-08-25T10:00:02.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "你好！" }],
					provider: "openai-compatible",
					model: "deepseek-v4-flash",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: Date.parse("2026-08-25T10:00:02.000Z"),
				},
			},
		});
		if (appended.isErr()) throw appended.error;
		database
			.prepare(
				`INSERT INTO operation_journal_records (session_id, sequence, operation_id, record_type, record_json)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				"session-1",
				100,
				"operation-1",
				"model_attempted",
				JSON.stringify({
					type: "model_attempted",
					operationId: "operation-1",
					attemptId: "attempt-1",
					assistantEntryId: "assistant-1",
					modelSnapshotId: "openai-compatible:deepseek-v4-flash",
					timestamp: "2026-08-25T10:00:02.000Z",
				}),
			);

		const loaded = await persistence.load("session-1");
		if (loaded.isErr()) throw loaded.error;
		expect(loaded.value.snapshot.entries.map((entry) => entry.id)).toEqual(["operation-1:input", "assistant-1"]);
		expect(loaded.value.operationRecords).toEqual([]);
		expect(loaded.value.journalFacts.every((fact) => fact.kind === "entry")).toBe(true);

		const host = new RuntimeHost({ persistence, createId: ids("ignored") });
		const resumed = await host.openSession({
			kind: "resume",
			id: "session-1",
			cwd: "/workspace",
			controllerId: "desktop",
		});
		if (resumed.isErr()) throw resumed.error;
		const snapshot = await resumed.value.snapshot();
		if (snapshot.isErr()) throw snapshot.error;
		expect(snapshot.value.entries.map((entry) => entry.id)).toEqual(["operation-1:input", "assistant-1"]);
		await resumed.value.close();
	});
});
