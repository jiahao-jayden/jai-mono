import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionIndex, type SessionInfo } from "../src/core/session/session-index.js";

function makeRecord(sessionId: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
	const now = Date.now();
	return {
		sessionId,
		workspaceId: "default",
		filePath: null,
		title: null,
		model: null,
		firstMessage: null,
		messageCount: 0,
		totalTokens: 0,
		lastInputTokens: 0,
		lastOutputTokens: 0,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("SessionIndex new token fields", () => {
	const TMP = join(tmpdir(), `jai-index-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const DB = join(TMP, "index.db");

	beforeEach(() => {
		mkdirSync(TMP, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP, { recursive: true, force: true });
	});

	test("upsert persists lastInputTokens/lastOutputTokens; get reads them back", async () => {
		const idx = await SessionIndex.open(DB);
		idx.upsert(makeRecord("s1", { lastInputTokens: 12_345, lastOutputTokens: 678, totalTokens: 99_999 }));

		const row = idx.get("s1");
		expect(row).not.toBeNull();
		expect(row!.lastInputTokens).toBe(12_345);
		expect(row!.lastOutputTokens).toBe(678);
		expect(row!.totalTokens).toBe(99_999);

		idx.close();
	});

	test("updateField(lastInputTokens) overrides (no accumulation)", async () => {
		const idx = await SessionIndex.open(DB);
		idx.upsert(makeRecord("s1", { lastInputTokens: 1000 }));

		idx.updateField("s1", "lastInputTokens", 5000);
		expect(idx.get("s1")!.lastInputTokens).toBe(5000);

		// compaction 后降回
		idx.updateField("s1", "lastInputTokens", 800);
		expect(idx.get("s1")!.lastInputTokens).toBe(800);

		idx.close();
	});

	test("migration: opens old DB (without last_*_tokens columns) and adds them with default 0", async () => {
		// 造一个"老版本" schema：没有 last_input_tokens / last_output_tokens 列
		const legacy = new Database(DB);
		legacy.exec(`
			CREATE TABLE sessions (
				session_id    TEXT PRIMARY KEY,
				workspace_id  TEXT NOT NULL DEFAULT 'default',
				file_path     TEXT,
				title         TEXT,
				model         TEXT,
				first_message TEXT,
				message_count INTEGER DEFAULT 0,
				total_tokens  INTEGER DEFAULT 0,
				created_at    INTEGER NOT NULL,
				updated_at    INTEGER NOT NULL
			);
		`);
		const now = Date.now();
		legacy
			.prepare(
				`INSERT INTO sessions (session_id, workspace_id, file_path, title, model, first_message, message_count, total_tokens, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run("old", "default", null, null, null, null, 0, 50_000, now, now);
		legacy.close();

		// 新版 SessionIndex.open 应该自动加列，且不丢老数据
		const idx = await SessionIndex.open(DB);
		const row = idx.get("old");
		expect(row).not.toBeNull();
		expect(row!.totalTokens).toBe(50_000);
		expect(row!.lastInputTokens).toBe(0);
		expect(row!.lastOutputTokens).toBe(0);

		// 新增列可正常写入
		idx.updateField("old", "lastInputTokens", 7777);
		expect(idx.get("old")!.lastInputTokens).toBe(7777);

		idx.close();
	});

	test("migration is idempotent (opening twice doesn't error)", async () => {
		const idx1 = await SessionIndex.open(DB);
		idx1.upsert(makeRecord("s1", { lastInputTokens: 100 }));
		idx1.close();

		const idx2 = await SessionIndex.open(DB);
		expect(idx2.get("s1")!.lastInputTokens).toBe(100);
		idx2.close();
	});
});
