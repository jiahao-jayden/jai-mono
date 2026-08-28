import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SessionConflictError, type SessionStore } from "../../src/harness";
import {
	appStateEntry,
	type AppState,
	chain,
	compactionEntry,
	defaultAppState as init,
	messageEntry,
} from "./fixtures";

const message = (id: string, text: string) => messageEntry(id, text, `2026-01-01T00:00:0${id.length}.000Z`);
const appState = (id: string, resolved: boolean) => appStateEntry(id, resolved, "2026-01-01T00:01:00.000Z");

export interface SessionStoreContractHarness {
	name: string;
	create: () => Promise<SessionStore<AppState>>;
	cleanup: () => Promise<void>;
}

export function describeSessionStoreContract(harness: SessionStoreContractHarness): void {
	describe(`${harness.name} (SessionStore contract)`, () => {
		let store: SessionStore<AppState>;

		beforeEach(async () => {
			store = await harness.create();
		});

		afterEach(async () => {
			await harness.cleanup();
		});

		test("load returns undefined for an unknown session", async () => {
			expect(await store.load("missing")).toBeUndefined();
		});

		test("create then load returns the initial snapshot", async () => {
			const revision = await store.create("s1", init);
			const record = await store.load("s1");

			expect(record?.revision).toBe(revision);
			expect(record?.readOnly).toBe(false);
			expect(record?.snapshot.appState).toEqual({ resolved: false });
			expect(record?.snapshot.entries).toEqual([]);
		});

		test("create rejects an existing session", async () => {
			await store.create("s1", init);
			expect(store.create("s1", init)).rejects.toBeInstanceOf(SessionConflictError);
		});

		test("append preserves order and folds app_state into the snapshot", async () => {
			const { entries, leafId } = chain(message("e0", "first"), message("e1", "second"), appState("e2", true));
			let revision = await store.create("s1", init);
			for (const entry of entries) revision = await store.append("s1", entry, revision);

			const record = await store.load("s1");

			expect(record?.revision).toBe(revision);
			expect(record?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0", "e1", "e2"]);
			expect(record?.snapshot.leafId).toBe(leafId);
			expect(record?.snapshot.appState).toEqual({ resolved: true });
			expect(record?.snapshot.updatedAt).toBe("2026-01-01T00:01:00.000Z");
		});

		test("append round-trips compaction entries", async () => {
			let revision = await store.create("s1", init);
			revision = await store.append("s1", message("e0", "first"), revision);
			revision = await store.append("s1", compactionEntry("e1", "summary", "e0", "2026-01-01T00:02:00.000Z"), revision);

			const record = await store.load("s1");

			expect(record?.readOnly).toBe(false);
			expect(record?.snapshot.entries[1]).toEqual(
				compactionEntry("e1", "summary", "e0", "2026-01-01T00:02:00.000Z"),
			);
		});

		test("a branch entry forks the tree: the old path survives and the leaf moves to the new one", async () => {
			const { entries } = chain(message("e0", "first"), appState("e1", true), message("e2", "abandoned"));
			let revision = await store.create("s1", init);
			for (const entry of entries) revision = await store.append("s1", entry, revision);

			// 回到 e0：e1 的 app_state 不在新分支上，appState 必须退回 header 初值。
			revision = await store.append(
				"s1",
				{
					type: "branch",
					id: "e3",
					parentId: "e0",
					timestamp: "2026-01-01T00:03:00.000Z",
					fromId: "e2",
				},
				revision,
			);

			const record = await store.load("s1");

			expect(record?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0", "e1", "e2", "e3"]);
			expect(record?.snapshot.leafId).toBe("e3");
			expect(record?.snapshot.appState).toEqual({ resolved: false });
		});

		test("append against a stale revision conflicts instead of overwriting", async () => {
			const stale = await store.create("s1", init);
			await store.append("s1", message("e0", "first"), stale);

			expect(store.append("s1", message("e1", "racing"), stale)).rejects.toBeInstanceOf(SessionConflictError);

			const record = await store.load("s1");
			expect(record?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0"]);
		});

		test("append to a missing session conflicts", async () => {
			expect(store.append("ghost", message("e0", "hi"), "r0")).rejects.toBeInstanceOf(SessionConflictError);
		});

		test("delete removes a session", async () => {
			await store.create("s1", init);
			await store.delete("s1");

			expect(await store.load("s1")).toBeUndefined();
		});
	});
}
