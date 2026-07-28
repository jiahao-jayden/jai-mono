import { describe, expect, test } from "bun:test";
import { InMemorySessionStore, openSession } from "../../../src/harness";
import { appStateEntry, defaultAppState, messageEntry, type AppState } from "../../support/fixtures";

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
});
