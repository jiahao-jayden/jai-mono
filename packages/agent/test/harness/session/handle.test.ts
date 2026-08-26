import { describe, expect, test } from "bun:test";
import { InMemorySessionStore, openSession, SessionConflictError } from "../../../src/harness";
import { appStateEntry, assistant, chain, defaultAppState, messageEntry, type AppState } from "../../support/fixtures";

describe("openSession", () => {
	test("creates on first open and loads on the next", async () => {
		const store = new InMemorySessionStore<AppState>();

		const first = await openSession(store, "s1", defaultAppState);
		await first.append(messageEntry("e0", "hi"));

		const second = await openSession(store, "s1", defaultAppState);
		expect(second.snapshot.entries.map((entry) => entry.id)).toEqual(["e0"]);
	});

	test("keeps its own snapshot in sync without reloading", async () => {
		const store = new InMemorySessionStore<AppState>();
		const session = await openSession(store, "s1", defaultAppState);

		await session.append(appStateEntry("e0", true));

		expect(session.snapshot.appState).toEqual({ resolved: true });
	});

	test("serializes concurrent appends instead of conflicting", async () => {
		const store = new InMemorySessionStore<AppState>();
		const session = await openSession(store, "s1", defaultAppState);

		await Promise.all(["e0", "e1", "e2"].map((id) => session.append(messageEntry(id, id))));

		expect((await store.load("s1"))?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0", "e1", "e2"]);
	});

	/** 另一个写者插入树节点后，活着的 handle 必须拒绝用旧 revision 覆盖。 */
	test("still refuses when a tree entry was written outside it", async () => {
		const store = new InMemorySessionStore<AppState>();
		const session = await openSession(store, "s1", defaultAppState);
		await session.append(messageEntry("e0", "hi"));

		const outside = await store.load("s1");
		await store.append(
			"s1",
			{
				type: "message",
				id: "e1",
				parentId: "e0",
				timestamp: "2026-01-01T00:00:00.000Z",
				message: { role: "user", content: "elsewhere", timestamp: 0 },
			},
			outside?.revision ?? "",
		);

		await expect(session.append(messageEntry("e2", "mine"))).rejects.toBeInstanceOf(SessionConflictError);
	});

	test("leaves unresolved tool calls untouched for the Runtime Host recovery protocol", async () => {
		const store = new InMemorySessionStore<AppState>();
		const first = await openSession(store, "s1", defaultAppState);
		const { entries } = chain<AppState>(
			{
				type: "message",
				id: "assistant-1",
				parentId: null,
				timestamp: "2026-08-05T00:00:00.000Z",
				message: {
					...assistant(""),
					content: [{ type: "toolCall", id: "call-1", name: "Read", arguments: { path: "README.md" } }],
					stopReason: "toolUse",
				},
			},
			messageEntry("user-2", "continue"),
		);
		for (const entry of entries) await first.append(entry);

		const reopened = await openSession(store, "s1", defaultAppState);
		expect(reopened.snapshot.entries.map((entry) => entry.id)).toEqual(["assistant-1", "user-2"]);
	});
});
