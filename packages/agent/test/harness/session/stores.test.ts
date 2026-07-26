import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	FileSessionStore,
	InMemorySessionStore,
	SessionConflictError,
	SessionReadOnlyError,
	serialized,
	type SessionStore,
} from "../../../src/harness";
import { appStateEntry, messageEntry, sessionInit as init, type AppState } from "../../support/fixtures";

const message = (id: string, text: string) => messageEntry(id, text, `2026-01-01T00:00:0${id.length}.000Z`);
const appState = (id: string, resolved: boolean) => appStateEntry(id, resolved, "2026-01-01T00:01:00.000Z");

interface Harness {
	name: string;
	create: () => Promise<SessionStore<AppState>>;
	cleanup: () => Promise<void>;
}

const temporaryDirectories: string[] = [];

const harnesses: Harness[] = [
	{
		name: "InMemorySessionStore",
		create: async () => new InMemorySessionStore<AppState>(),
		cleanup: async () => {},
	},
	{
		name: "FileSessionStore",
		create: async () => {
			const directory = await makeTempDir();
			temporaryDirectories.push(directory);
			return new FileSessionStore<AppState>(directory);
		},
		cleanup: async () => {
			await Promise.all(temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
		},
	},
];

async function makeTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "jai-session-"));
}

for (const harness of harnesses) {
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
			expect(record?.snapshot.systemPrompt).toBe(init.systemPrompt);
			expect(record?.snapshot.appState).toEqual({ resolved: false });
			expect(record?.snapshot.entries).toEqual([]);
		});

		test("create rejects an existing session", async () => {
			await store.create("s1", init);
			expect(store.create("s1", init)).rejects.toBeInstanceOf(SessionConflictError);
		});

		test("append preserves order and folds app_state into the snapshot", async () => {
			let revision = await store.create("s1", init);
			revision = await store.append("s1", message("e0", "first"), revision);
			revision = await store.append("s1", message("e1", "second"), revision);
			revision = await store.append("s1", appState("e2", true), revision);

			const record = await store.load("s1");

			expect(record?.revision).toBe(revision);
			expect(record?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0", "e1", "e2"]);
			expect(record?.snapshot.appState).toEqual({ resolved: true });
			expect(record?.snapshot.updatedAt).toBe("2026-01-01T00:01:00.000Z");
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

describe("FileSessionStore (durability)", () => {
	let directory: string;

	beforeEach(async () => {
		directory = await makeTempDir();
	});

	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});

	function open(): FileSessionStore<AppState> {
		return new FileSessionStore<AppState>(directory);
	}

	test("another instance on the same directory sees the data", async () => {
		const writer = open();
		const revision = await writer.create("s1", init);
		await writer.append("s1", message("e0", "first"), revision);

		const record = await open().load("s1");
		expect(record?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0"]);
	});

	test("ignores a torn trailing commit", async () => {
		const store = open();
		const revision = await store.create("s1", init);
		await store.append("s1", message("e0", "first"), revision);
		await fs.appendFile(path.join(directory, "s1.jsonl"), '{"type":"message","id":"e1"');

		const record = await store.load("s1");
		expect(record?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0"]);
		expect(record?.revision).toBe((await store.load("s1"))?.revision);
	});

	test("drops the entry but keeps the session readable when an entry type is unknown", async () => {
		const store = open();
		const revision = await store.create("s1", init);
		await store.append("s1", message("e0", "first"), revision);
		await fs.appendFile(
			path.join(directory, "s1.jsonl"),
			'{"type":"branch","id":"e1"}\n{"type":"revision","value":"r-future"}\n',
		);

		const record = await store.load("s1");
		expect(record?.readOnly).toBe(true);
		expect(record?.snapshot.entries.map((entry) => entry.id)).toEqual(["e0"]);

		expect(store.append("s1", message("e2", "nope"), record?.revision ?? "")).rejects.toBeInstanceOf(
			SessionReadOnlyError,
		);
	});

	test("refuses a schema version newer than this build", async () => {
		const store = open();
		await store.create("s1", init);
		const file = path.join(directory, "s1.jsonl");
		const [header, ...rest] = (await fs.readFile(file, "utf8")).split("\n");
		await fs.writeFile(file, [(header ?? "").replace('"version":1', '"version":99'), ...rest].join("\n"));

		expect(store.load("s1")).rejects.toThrow(/schema version/);
	});

	test("rejects session ids that escape the directory", async () => {
		expect(open().load("../escape")).rejects.toThrow(/Invalid session id/);
	});
});
