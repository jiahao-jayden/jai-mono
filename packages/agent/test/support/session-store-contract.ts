import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { zeroUsage } from "@jai/ai";
import {
	attachSession,
	SessionConflictError,
	SessionFollowLost,
	serialized,
	type SessionStore,
} from "../../src/harness";
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

/** 契约测试里 session 一定存在，attach 失败就是测试自身的缺陷，直接抛。 */
async function attach(store: SessionStore<AppState>, id: string) {
	const result = await attachSession(store, id);
	if (result.isErr()) throw result.error;
	return result.value;
}

export interface SessionStoreContractHarness {
	name: string;
	create: () => Promise<SessionStore<AppState>>;
	cleanup: () => Promise<void>;
}

const temporaryDirectories: string[] = [];

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

		test("list reports created sessions", async () => {
			await store.create("s1", init);
			await store.create("s2", init);

			expect((await store.list()).sort()).toEqual(["s1", "s2"]);
		});

		test("delete removes a session", async () => {
			await store.create("s1", init);
			await store.delete("s1");

			expect(await store.load("s1")).toBeUndefined();
			expect(await store.list()).not.toContain("s1");
		});

		test("follow streams committed entries and supports an opaque cursor", async () => {
			let revision = await store.create("s1", init);
			const updates: string[] = [];
			let resolve!: () => void;
			const done = new Promise<void>((finish) => (resolve = finish));
			const stop = store.follow("s1", undefined, (result) => {
				if (result.isErr()) throw result.error;
				updates.push(...result.value.entries.map((entry) => entry.id));
				if (updates.length === 3) resolve();
			});
			for (const entry of [message("e0", "0"), message("e1", "1"), message("e2", "2")]) {
				revision = await store.append("s1", entry, revision);
			}
			await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("follow timeout")), 1000))]);
			stop();
			expect(updates).toEqual(["e0", "e1", "e2"]);

			const after: string[] = [];
			const stopAfter = store.follow("s1", "e0", (result) => {
				if (result.isOk()) after.push(...result.value.entries.map((entry) => entry.id));
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			await store.append("s1", message("e3", "3"), revision);
			await new Promise((resolve) => setTimeout(resolve, 300));
			stopAfter();
			expect(after).toEqual(["e1", "e2", "e3"]);
		});

		/**
		 * 删除必须把 follower 一起断开。同一个 id 事后可以再被 create()，留着的
		 * follower 会把新会话的 entry 当成旧会话的续写投递出去。
		 */
		test("delete disconnects followers", async () => {
			const revision = await store.create("s1", init);
			await store.append("s1", message("e0", "first"), revision);
			const errors: string[] = [];
			const entries: string[] = [];
			store.follow("s1", undefined, (result) => {
				if (result.isErr()) errors.push(result.error._tag);
				else entries.push(...result.value.entries.map((entry) => entry.id));
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(entries).toEqual(["e0"]);

			await store.delete("s1");
			await new Promise((resolve) => setTimeout(resolve, 1_200));
			expect(errors).toEqual(["session.follow_lost"]);

			// 同 id 重建之后，被断开的 follower 不该再收到任何东西。
			const reborn = await store.create("s1", init);
			await store.append("s1", message("e9", "reborn"), reborn);
			await new Promise((resolve) => setTimeout(resolve, 1_200));
			expect(entries).toEqual(["e0"]);
		});

		test("follow rejects an unknown cursor", async () => {
			await store.create("s1", init);
			let error: SessionFollowLost | undefined;
			store.follow("s1", "missing", (result) => {
				if (result.isErr()) error = result.error;
			});
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(error?._tag).toBe("session.follow_lost");
		});

		test("attach projects changes without exposing append", async () => {
			let revision = await store.create("s1", init);
			const attachment = await attach(store, "s1");
			const snapshots: string[][] = [];
			let resolve!: () => void;
			const done = new Promise<void>((finish) => (resolve = finish));
			const stop = attachment.onChange((snapshot) => {
				snapshots.push(snapshot.entries.map((entry) => entry.id));
				if (snapshot.entries.length === 3) resolve();
			});
			for (const entry of [message("e0", "first"), message("e1", "second"), message("e2", "third")]) {
				revision = await store.append("s1", entry, revision);
			}
			await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("attachment timeout")), 1000))]);
			stop();
			attachment.close();
			await store.append("s1", message("e3", "after close"), revision);
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(snapshots.at(-1)).toEqual(["e0", "e1", "e2"]);
			expect(snapshots.flat()).not.toContain("e3");
			expect(attachment).not.toHaveProperty("append");
		});

		/**
		 * serialized() 只保证操作逐个执行，不会把"读-改-写"变成事务：
		 * 两个用同一 revision 的写者仍然只有一个能赢，但输的那个拿到的是
		 * 确定的 SessionConflictError，而不是取决于时序的锁竞争错误。
		 */
		test("serialized() runs operations one at a time", async () => {
			const queued = serialized(store);
			const revision = await queued.create("s1", init);

			const [first, second] = await Promise.allSettled([
				queued.append("s1", message("e0", "first"), revision),
				queued.append("s1", message("e1", "racing"), revision),
			]);

			expect(first?.status).toBe("fulfilled");
			expect(second?.status).toBe("rejected");
			expect((second as PromiseRejectedResult).reason).toBeInstanceOf(SessionConflictError);
			expect((await queued.load("s1"))?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0"]);
		});
	});
}
