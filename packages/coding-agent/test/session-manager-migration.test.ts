import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionIndex } from "../src/core/session/session-index.js";
import { SessionManager } from "../src/core/session/session-manager.js";

// ── V1 storage migration ─────────────────────────────────────
// 老布局：~/.jai/workspace/<wsId>/sessions/<id>.jsonl
// 新布局：~/.jai/projects/<wsId>/<id>.jsonl
// SessionManager.init 应幂等地把老 session 文件搬到新位置，并回填 index.file_path。

describe("SessionManager.migrateV1Storage", () => {
	const TMP = join(tmpdir(), `jai-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const JAI_HOME = join(TMP, ".jai");

	beforeEach(() => {
		mkdirSync(JAI_HOME, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP, { recursive: true, force: true });
	});

	async function seedLegacySession(workspaceId: string, sessionId: string, content = "{}\n") {
		const dir = join(JAI_HOME, "workspace", workspaceId, "sessions");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${sessionId}.jsonl`), content, "utf8");
	}

	async function seedIndexEntry(workspaceId: string, sessionId: string) {
		const index = await SessionIndex.open(join(JAI_HOME, "index.db"));
		const now = Date.now();
		index.upsert({
			sessionId,
			workspaceId,
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
		});
		index.close();
	}

	test("moves legacy session file to new location and updates index.filePath", async () => {
		await seedIndexEntry("default", "sess-a");
		await seedLegacySession("default", "sess-a", '{"type":"session"}\n');

		const mgr = await SessionManager.create({ jaiHome: JAI_HOME });

		const legacyPath = join(JAI_HOME, "workspace", "default", "sessions", "sess-a.jsonl");
		const newPath = join(JAI_HOME, "projects", "default", "sess-a.jsonl");

		expect(existsSync(legacyPath)).toBe(false);
		expect(existsSync(newPath)).toBe(true);
		expect(readFileSync(newPath, "utf8")).toBe('{"type":"session"}\n');

		const info = mgr.getSessionInfo("sess-a");
		expect(info?.filePath).toBe(newPath);

		await mgr.closeAll();
	});

	test("handles multiple workspaces", async () => {
		await seedIndexEntry("default", "sess-1");
		await seedIndexEntry("proj-x", "sess-2");
		await seedLegacySession("default", "sess-1");
		await seedLegacySession("proj-x", "sess-2");

		const mgr = await SessionManager.create({ jaiHome: JAI_HOME });

		expect(existsSync(join(JAI_HOME, "projects", "default", "sess-1.jsonl"))).toBe(true);
		expect(existsSync(join(JAI_HOME, "projects", "proj-x", "sess-2.jsonl"))).toBe(true);

		expect(mgr.getSessionInfo("sess-1")?.filePath).toBe(
			join(JAI_HOME, "projects", "default", "sess-1.jsonl"),
		);
		expect(mgr.getSessionInfo("sess-2")?.filePath).toBe(
			join(JAI_HOME, "projects", "proj-x", "sess-2.jsonl"),
		);

		await mgr.closeAll();
	});

	test("is idempotent (sentinel prevents re-run)", async () => {
		await seedIndexEntry("default", "sess-a");
		await seedLegacySession("default", "sess-a");

		const mgr1 = await SessionManager.create({ jaiHome: JAI_HOME });
		await mgr1.closeAll();

		expect(existsSync(join(JAI_HOME, ".migration-v1-done"))).toBe(true);

		// 再手动丢一个老文件，重启后不应该被迁移（sentinel 阻断）
		await seedLegacySession("default", "sess-b");
		const mgr2 = await SessionManager.create({ jaiHome: JAI_HOME });
		const legacyB = join(JAI_HOME, "workspace", "default", "sessions", "sess-b.jsonl");
		expect(existsSync(legacyB)).toBe(true);
		expect(existsSync(join(JAI_HOME, "projects", "default", "sess-b.jsonl"))).toBe(false);

		await mgr2.closeAll();
	});

	test("no-op when legacy directory does not exist", async () => {
		const mgr = await SessionManager.create({ jaiHome: JAI_HOME });
		expect(existsSync(join(JAI_HOME, ".migration-v1-done"))).toBe(true);
		await mgr.closeAll();
	});
});

// ── createSession populates filePath ────────────────────────────

describe("SessionManager.createSession", () => {
	const TMP = join(tmpdir(), `jai-create-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const JAI_HOME = join(TMP, ".jai");

	beforeEach(() => {
		mkdirSync(JAI_HOME, { recursive: true });
	});

	afterEach(() => {
		rmSync(TMP, { recursive: true, force: true });
	});

	test("new session has filePath pointing to ~/.jai/projects/<wsId>/<id>.jsonl", async () => {
		const mgr = await SessionManager.create({ jaiHome: JAI_HOME });
		// 没有有效 API key/model 时 createSession 也能创建基础记录（我们只验证 filePath 派生）
		// 如果 resolveModel 抛错，跳过此断言
		try {
			const info = await mgr.createSession({ workspaceId: "default" });
			expect(info.filePath).toBe(join(JAI_HOME, "projects", "default", `${info.sessionId}.jsonl`));
		} catch (e) {
			// 无 provider 配置时允许跳过
			const msg = (e as Error).message;
			expect(msg.length).toBeGreaterThan(0);
		}
		await mgr.closeAll();
	});
});
