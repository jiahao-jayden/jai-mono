import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { InMemorySessionStore } from "@jai/agent";
import {
	applyEntry,
	type CodingSessionStore,
	emptySnapshot,
	SessionConflictError,
	type StoredSession,
} from "../../src/sdk";
import { lastAssistant, settleWithin, useBoundaryFixture } from "./harness";

const fixture = useBoundaryFixture();

type Env = Awaited<ReturnType<typeof fixture.prepare>>;
const session = (env: Env, id: string, store: object, kind: "new" | "resume" = "new") =>
	fixture.tryOpen({
		cwd: env.workspace,
		session: { kind, id, store },
		fileCapabilities: { homeDirectory: env.home, workspaceDirectory: env.workspace, workspaceTrusted: true },
	} as never);
const jaiTempDirectories = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("jai-coding-agent-")).length;

// A host store written against the public exports only, with JSON-serialised records as a real
// database would hold them.
function hostStore(): CodingSessionStore {
	const rows = new Map<string, string>();
	const read = (id: string) => {
		const row = rows.get(id);
		return row ? (JSON.parse(row) as StoredSession) : undefined;
	};
	return {
		async load(id) {
			return read(id);
		},
		async create(id, appState) {
			if (rows.has(id)) throw new SessionConflictError({ message: "exists" });
			rows.set(id, JSON.stringify({ snapshot: emptySnapshot(appState, new Date().toISOString()), revision: "0", readOnly: false }));
			return "0";
		},
		async append(id, entry, expectedRevision) {
			const current = read(id);
			if (!current || current.revision !== expectedRevision) throw new SessionConflictError({ message: "stale revision" });
			const revision = String(Number(current.revision) + 1);
			rows.set(id, JSON.stringify({ ...current, snapshot: applyEntry(current.snapshot, entry), revision }));
			return revision;
		},
		async delete(id) {
			rows.delete(id);
		},
	};
}

describe("persistent session boundary", () => {
	test("a host store built from the public exports persists and resumes a session", async () => {
		const env = await fixture.prepare();
		const store = hostStore();
		fixture.script({ kind: "text", text: "first" });
		const first = await session(env, "host-1", store);
		if (first.isErr()) throw new Error(first.error.message);
		await first.value.prompt("hello");
		await first.value.close();
		const resumed = await session(env, "host-1", store, "resume");
		if (resumed.isErr()) throw new Error(resumed.error.message);
		expect(resumed.value.state.messages).toHaveLength(2);
	});

	test("resume replays the stored transcript to the model", async () => {
		const env = await fixture.prepare();
		const store = new InMemorySessionStore();
		fixture.script({ kind: "text", text: "first" });
		const first = await session(env, "s1", store);
		if (first.isErr()) throw new Error(first.error.message);
		await first.value.prompt("hello");
		await first.value.close();

		fixture.mock.requests.length = 0;
		fixture.script({ kind: "text", text: "second" });
		const resumed = await session(env, "s1", store, "resume");
		if (resumed.isErr()) throw new Error(resumed.error.message);
		await resumed.value.prompt("again");
		expect(resumed.value.state.messages).toHaveLength(4);
		const sent = JSON.stringify(fixture.mock.requests[0]?.body?.messages);
		expect(sent).toContain("hello");
		expect(sent).toContain("first");
	});

	test("resume of a missing session is an error, never a silent new session", async () => {
		const env = await fixture.prepare();
		const resumed = await session(env, "ghost", new InMemorySessionStore(), "resume");
		expect(resumed.isErr() && resumed.error).toMatchObject({ code: "coding_sdk.session_not_found", phase: "session" });
	});

	test("creating a session whose id already exists is rejected", async () => {
		const env = await fixture.prepare();
		const store = new InMemorySessionStore();
		expect((await session(env, "dup", store)).isOk()).toBe(true);
		expect((await session(env, "dup", store)).isErr()).toBe(true);
	});

	test("a store that is not a SessionStore fails creation instead of failing on first write", async () => {
		const env = await fixture.prepare();
		const created = await session(env, "bad", {});
		expect(created.isErr()).toBe(true);
	});

	test("a corrupt stored session fails creation with an Err (error text is an internal TypeError)", async () => {
		const env = await fixture.prepare();
		const corrupt = { load: async () => ({ snapshot: { entries: "garbage" }, revision: "1" }), create: async () => "1", append: async () => "2", delete: async () => {} };
		const resumed = await session(env, "c", corrupt, "resume");
		expect(resumed.isErr()).toBe(true);
	});

	// A durable-write failure is not an Err from prompt(): the run resolves Ok with stopReason
	// "error" and state.status "aborted". Hosts that need durability guarantees must check both.
	test("a failing store.append mid-run surfaces as an errored run, not a rejected prompt", async () => {
		const env = await fixture.prepare();
		const inner = new InMemorySessionStore();
		let appends = 0;
		const flaky = {
			load: (id: string) => inner.load(id),
			create: (id: string, state: never) => inner.create(id, state),
			delete: (id: string) => inner.delete(id),
			append: async (id: string, entry: never, revision: string) => {
				if (++appends === 3) throw new Error("db down");
				return inner.append(id, entry, revision);
			},
		};
		fixture.script({ kind: "text", text: "ok" });
		const created = await session(env, "flaky", flaky);
		if (created.isErr()) throw new Error(created.error.message);
		expect(lastAssistant(await created.value.prompt("one")).stopReason).toBe("stop");
		const failed = await created.value.prompt("two");
		expect(lastAssistant(failed).stopReason).toBe("error");
		expect(created.value.state.status).toBe("aborted");
		expect((await created.value.prompt("three")).isOk()).toBe(true);
	});

	// ponytail: a store whose append never settles blocks prompt() with no deadline. Ceiling:
	// a stalled database stalls every run on it. Upgrade path: per-append timeout owned by the host store adapter.
	test("a stalled store.append stalls prompt() (documented: the store owns its own deadline)", async () => {
		const env = await fixture.prepare();
		const inner = new InMemorySessionStore();
		let appends = 0;
		const stalled = {
			load: (id: string) => inner.load(id),
			create: (id: string, state: never) => inner.create(id, state),
			delete: (id: string) => inner.delete(id),
			append: (id: string, entry: never, revision: string) => (++appends >= 2 ? new Promise<string>(() => {}) : inner.append(id, entry, revision)),
		};
		fixture.script({ kind: "text", text: "ok" });
		const created = await session(env, "stalled", stalled);
		if (created.isErr()) throw new Error(created.error.message);
		expect(await settleWithin(created.value.prompt("x"), 1000)).toBe("timeout");
	});

	test("two live agents on one session id: the loser fails with a conflict instead of forking history", async () => {
		const env = await fixture.prepare();
		const store = new InMemorySessionStore();
		const a = await session(env, "shared", store);
		const b = await session(env, "shared", store, "resume");
		if (a.isErr() || b.isErr()) throw new Error("setup failed");
		fixture.script({ kind: "text", text: "x", chunks: 3, chunkDelayMs: 20 });
		const [ra, rb] = await Promise.all([a.value.prompt("A"), b.value.prompt("B")]);
		const failures = [ra, rb].flatMap((result) => (result.isErr() ? [result.error] : []));
		expect(failures).toHaveLength(1);
		expect(failures[0]?.code).toBe("session.conflict");
	});
});

describe("resource boundary", () => {
	test("ephemeral agents leak one temp directory each until close() is called", async () => {
		await fixture.prepare();
		const before = await jaiTempDirectories();
		const agents = await Promise.all(Array.from({ length: 10 }, () => fixture.open()));
		expect(await jaiTempDirectories()).toBe(before + 10);
		await Promise.all(agents.map((agent) => agent.close()));
		expect(await jaiTempDirectories()).toBe(before);
	});

	test("200 create/prompt/close cycles do not leak file descriptors", async () => {
		await fixture.prepare();
		const fds = async () => (await readdir("/proc/self/fd")).length;
		fixture.script({ kind: "text", text: "ok" });
		const before = await fds();
		for (let index = 0; index < 200; index++) {
			const agent = await fixture.open();
			await agent.prompt("x");
			await agent.close();
		}
		expect(await fds()).toBeLessThanOrEqual(before + 2);
	});

	test("50 agents prompting concurrently in one process all complete", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "ok", chunks: 5, chunkDelayMs: 5 });
		const agents = await Promise.all(Array.from({ length: 50 }, () => fixture.open()));
		const results = await Promise.all(agents.map((agent) => agent.prompt("x")));
		expect(results.every((result) => result.isOk() && lastAssistant(result).stopReason === "stop")).toBe(true);
	});

	test("150 sequential turns on one session stay fast (no quadratic slowdown)", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "ok" });
		const agent = await fixture.open({ autoCompaction: false });
		const started = Date.now();
		for (let index = 0; index < 150; index++) await agent.prompt(`turn ${index} ${"w".repeat(200)}`);
		expect(Date.now() - started).toBeLessThan(5000);
		expect(agent.state.messages).toHaveLength(300);
	});

	test("auto compaction keeps a small-window session going across many large prompts", async () => {
		await fixture.prepare();
		fixture.script({ kind: "text", text: "ok" });
		const agent = await fixture.open({ modelMetadata: { contextWindow: 20_000, maxTokens: 1000 } });
		const compactions: string[] = [];
		agent.subscribe((event) => {
			if (event.type === "compaction_end") compactions.push(event.type);
		});
		let last;
		for (let index = 0; index < 8; index++) last = await agent.prompt(`p${index} ${"w".repeat(12_000)}`);
		expect(compactions.length).toBeGreaterThan(0);
		expect(lastAssistant(last!).stopReason).toBe("stop");
	});
});
