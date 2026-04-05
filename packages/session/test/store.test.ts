import { describe, test, expect, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@jayden/jai-ai";
import { buildSessionContext } from "../src/context.js";
import { InMemorySessionStore } from "../src/stores/memory-store.js";
import { JsonlSessionStore } from "../src/stores/jsonl-store.js";
import type { CompactionEntry, MessageEntry, SessionHeader, SessionStore } from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────

function makeUserMessage(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function makeAssistantMessage(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		timestamp: Date.now(),
	};
}

function makeHeader(store: SessionStore, sessionId = "test-session"): SessionHeader {
	return {
		type: "session",
		id: store.nextId(),
		parentId: null,
		version: 1,
		sessionId,
		timestamp: Date.now(),
	};
}

function makeMessageEntry(store: SessionStore, parentId: string, message: Message): MessageEntry {
	return {
		type: "message",
		id: store.nextId(),
		parentId,
		timestamp: message.timestamp,
		message,
	};
}

// ── InMemorySessionStore ─────────────────────────────────────

describe("InMemorySessionStore", () => {
	test("append and getBranch: linear history", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("hi there"));
		await store.append(m2);

		const m3 = makeMessageEntry(store, m2.id, makeUserMessage("how are you"));
		await store.append(m3);

		const branch = store.getBranch(m3.id);
		expect(branch).toHaveLength(4);
		expect(branch[0].type).toBe("session");
		expect(branch[1].id).toBe(m1.id);
		expect(branch[2].id).toBe(m2.id);
		expect(branch[3].id).toBe(m3.id);
	});

	test("getBranch: fork returns correct branch", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("start"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("response"));
		await store.append(m2);

		// 分支 A
		const m3a = makeMessageEntry(store, m2.id, makeUserMessage("branch A"));
		await store.append(m3a);

		// 分支 B
		const m3b = makeMessageEntry(store, m2.id, makeUserMessage("branch B"));
		await store.append(m3b);

		const branchA = store.getBranch(m3a.id);
		expect(branchA).toHaveLength(4);
		expect((branchA[3] as MessageEntry).message).toEqual(m3a.message);

		const branchB = store.getBranch(m3b.id);
		expect(branchB).toHaveLength(4);
		expect((branchB[3] as MessageEntry).message).toEqual(m3b.message);
	});

	test("getBranch without leafId returns latest", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const branch = store.getBranch();
		expect(branch).toHaveLength(2);
		expect(branch[branch.length - 1].id).toBe(m1.id);
	});

	test("getAllEntries returns copy", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const entries = store.getAllEntries();
		expect(entries).toHaveLength(1);

		// 修改返回的数组不影响 store 内部
		entries.push(header);
		expect(store.getAllEntries()).toHaveLength(1);
	});

	test("list returns session info", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("hi"));
		await store.append(m2);

		const sessions = await store.list();
		expect(sessions).toHaveLength(1);
		expect(sessions[0].sessionId).toBe("test-session");
		expect(sessions[0].messageCount).toBe(2);
	});

	test("list correctly separates multiple sessions", async () => {
		const store = new InMemorySessionStore();

		// session A
		const headerA = makeHeader(store, "session-a");
		await store.append(headerA);
		const a1 = makeMessageEntry(store, headerA.id, makeUserMessage("hello A"));
		await store.append(a1);

		// session B
		const headerB = makeHeader(store, "session-b");
		await store.append(headerB);
		const b1 = makeMessageEntry(store, headerB.id, makeUserMessage("hello B"));
		await store.append(b1);
		const b2 = makeMessageEntry(store, b1.id, makeAssistantMessage("hi B"));
		await store.append(b2);

		const sessions = await store.list();
		expect(sessions).toHaveLength(2);

		const a = sessions.find((s) => s.sessionId === "session-a")!;
		const b = sessions.find((s) => s.sessionId === "session-b")!;
		expect(a.messageCount).toBe(1);
		expect(b.messageCount).toBe(2);
	});
});

// ── JsonlSessionStore ────────────────────────────────────────

describe("JsonlSessionStore", () => {
	let tmpDir: string;

	afterEach(async () => {
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	async function makeTmpStore(): Promise<JsonlSessionStore> {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jai-jsonl-test-"));
		return JsonlSessionStore.open(path.join(tmpDir, "test.jsonl"));
	}

	test("append and getBranch: linear history", async () => {
		const store = await makeTmpStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("hi there"));
		await store.append(m2);

		const m3 = makeMessageEntry(store, m2.id, makeUserMessage("how are you"));
		await store.append(m3);

		const branch = store.getBranch(m3.id);
		expect(branch).toHaveLength(4);
		expect(branch[0].type).toBe("session");
		expect(branch[1].id).toBe(m1.id);
		expect(branch[2].id).toBe(m2.id);
		expect(branch[3].id).toBe(m3.id);
	});

	test("getBranch: fork returns correct branch", async () => {
		const store = await makeTmpStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("start"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("response"));
		await store.append(m2);

		const m3a = makeMessageEntry(store, m2.id, makeUserMessage("branch A"));
		await store.append(m3a);

		const m3b = makeMessageEntry(store, m2.id, makeUserMessage("branch B"));
		await store.append(m3b);

		const branchA = store.getBranch(m3a.id);
		expect(branchA).toHaveLength(4);
		expect((branchA[3] as MessageEntry).message).toEqual(m3a.message);

		const branchB = store.getBranch(m3b.id);
		expect(branchB).toHaveLength(4);
		expect((branchB[3] as MessageEntry).message).toEqual(m3b.message);
	});

	test("survives restart — data persists across open calls", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jai-jsonl-test-"));
		const filePath = path.join(tmpDir, "persist.jsonl");

		const store1 = await JsonlSessionStore.open(filePath);
		const header = makeHeader(store1);
		await store1.append(header);

		const m1 = makeMessageEntry(store1, header.id, makeUserMessage("hello"));
		await store1.append(m1);

		const m2 = makeMessageEntry(store1, m1.id, makeAssistantMessage("hi"));
		await store1.append(m2);
		await store1.close();

		const store2 = await JsonlSessionStore.open(filePath);
		expect(store2.getAllEntries()).toHaveLength(3);

		const branch = store2.getBranch();
		expect(branch).toHaveLength(3);
		expect(branch[0].type).toBe("session");
		expect((branch[1] as MessageEntry).message.role).toBe("user");
		expect((branch[2] as MessageEntry).message.role).toBe("assistant");
	});

	test("handles non-existent file gracefully", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jai-jsonl-test-"));
		const store = await JsonlSessionStore.open(path.join(tmpDir, "nope.jsonl"));
		expect(store.getAllEntries()).toHaveLength(0);
		expect(store.getBranch()).toHaveLength(0);
	});

	test("list returns session info", async () => {
		const store = await makeTmpStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("hi"));
		await store.append(m2);

		const sessions = await store.list();
		expect(sessions).toHaveLength(1);
		expect(sessions[0].sessionId).toBe("test-session");
		expect(sessions[0].messageCount).toBe(2);
	});

	test("buildSessionContext works with jsonl store", async () => {
		const store = await makeTmpStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("hi"));
		await store.append(m2);

		const messages = buildSessionContext(store, m2.id);
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");
	});
});

// ── buildSessionContext ──────────────────────────────────────

describe("buildSessionContext", () => {
	test("builds message list from branch (no compaction)", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("hi"));
		await store.append(m2);

		const messages = buildSessionContext(store, m2.id);
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");
	});

	test("skips session header", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("hello"));
		await store.append(m1);

		const messages = buildSessionContext(store, m1.id);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
	});

	test("compaction replaces old messages with summary", async () => {
		const store = new InMemorySessionStore();

		const header = makeHeader(store);
		await store.append(header);

		const m1 = makeMessageEntry(store, header.id, makeUserMessage("first"));
		await store.append(m1);

		const m2 = makeMessageEntry(store, m1.id, makeAssistantMessage("response 1"));
		await store.append(m2);

		const m3 = makeMessageEntry(store, m2.id, makeUserMessage("second"));
		await store.append(m3);

		const m4 = makeMessageEntry(store, m3.id, makeAssistantMessage("response 2"));
		await store.append(m4);

		// 压缩：m1、m2 被摘要替代，m3、m4 保留
		const compEntry: CompactionEntry = {
			type: "compaction",
			id: store.nextId(),
			parentId: m4.id,
			timestamp: Date.now(),
			summary: "## Summary\nUser asked two things. First response was given.",
			firstKeptEntryId: m3.id,
		};
		await store.append(compEntry);

		const messages = buildSessionContext(store, compEntry.id);

		// 应该是：[摘要] + [m3] + [m4] = 3 条
		expect(messages).toHaveLength(3);
		expect(messages[0].role).toBe("user");
		expect((messages[0] as any).content[0].text).toContain("Summary");
		expect(messages[1].role).toBe("user");
		expect((messages[1] as any).content[0].text).toBe("second");
		expect(messages[2].role).toBe("assistant");
	});
});
