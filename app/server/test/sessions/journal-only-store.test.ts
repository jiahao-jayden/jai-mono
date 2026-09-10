import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { type JsonObject, openSession, type SessionEntry } from "@jai/agent";
import { JournalOnlySessionStore } from "../../src/sessions";
import { SqliteProductSessionPersistence } from "../../src/persistence";

describe("JournalOnlySessionStore", () => {
	test("creates, appends and reloads a journal-only session without entering the product catalog", async () => {
		const persistence = new SqliteProductSessionPersistence(new DatabaseSync(":memory:"));
		const store = new JournalOnlySessionStore<JsonObject>(persistence);

		const handle = await openSession(store, "child-1", {});
		await handle.append({
			type: "message",
			id: "msg-1",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "hello child", timestamp: Date.now() },
		});

		const listResult = await persistence.list();
		expect(listResult.isOk()).toBe(true);
		if (listResult.isOk()) {
			expect(listResult.value).toEqual([]);
		}

		const reloaded = await store.load("child-1");
		expect(reloaded).toBeDefined();
		expect(reloaded!.snapshot.entries).toHaveLength(1);
		expect(reloaded!.snapshot.entries[0]).toMatchObject({
			id: "msg-1",
			message: { role: "user", content: "hello child" },
		});

		persistence.close();
	});

	test("survives persistence reopen and replays the same entries", async () => {
		const db = new DatabaseSync(":memory:");
		const persistence = new SqliteProductSessionPersistence(db);
		const store = new JournalOnlySessionStore<JsonObject>(persistence);

		const handle = await openSession(store, "child-2", {});
		await handle.append({
			type: "message",
			id: "msg-2",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "child reply" }],
				provider: "test",
				model: "test",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
		});

		const reopened = new SqliteProductSessionPersistence(db);
		const store2 = new JournalOnlySessionStore<JsonObject>(reopened);
		const reloaded = await store2.load("child-2");
		expect(reloaded).toBeDefined();
		expect(reloaded!.snapshot.entries).toHaveLength(1);
		expect(reloaded!.snapshot.entries[0]).toMatchObject({
			message: { role: "assistant", content: [{ type: "text", text: "child reply" }] },
		});

		reopened.close();
	});

	test("appends are isolated from the parent session catalog", async () => {
		const persistence = new SqliteProductSessionPersistence(new DatabaseSync(":memory:"));

		const created = await persistence.create({
			id: "parent-1",
			appState: {},
			runtimeConfiguration: { model: "test", mode: "manual" },
			cwd: "/workspace",
			createdAt: new Date().toISOString(),
		});
		expect(created.isOk()).toBe(true);

		const store = new JournalOnlySessionStore<JsonObject>(persistence);
		const handle = await openSession(store, "parent-1:toolcall-1", {});
		await handle.append({
			type: "message",
			id: "child-msg",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "child only", timestamp: Date.now() },
		});

		const parentLoaded = await persistence.load("parent-1");
		expect(parentLoaded.isOk()).toBe(true);
		if (parentLoaded.isOk()) {
			expect(parentLoaded.value.snapshot.entries).toEqual([]);
		}

		const childLoaded = await store.load("parent-1:toolcall-1");
		expect(childLoaded).toBeDefined();
		expect(childLoaded!.snapshot.entries).toHaveLength(1);

		persistence.close();
	});
});
