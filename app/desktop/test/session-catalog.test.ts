import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSession, type JsonObject } from "@jai/agent";
import { SqliteSessionStore } from "@jai/agent/node";
import { emptyPersistedCodingSessionState } from "@jai/coding-agent";
import { DesktopSessionCatalog } from "../electron/session-catalog";

const roots: string[] = [];
const services: DesktopSessionCatalog[] = [];

afterEach(async () => {
	for (const service of services.splice(0)) service.close();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopSessionCatalog", () => {
	test("一个 SQLite 文件同时保存 journal 与 Desktop metadata，但两者独立演化", async () => {
		const fixture = await createFixture(["project-1", "session-1"]);
		const folder = join(fixture.root, "project");
		await mkdir(folder);
		const project = await fixture.service.createProject({ path: folder });
		const session = await fixture.service.createSession({
			projectId: project.id,
			firstMessage: "Initial title",
			appState: { selected: true },
		});
		const beforeRename = await fixture.service.loadSessionSnapshot(session.id);

		await fixture.service.renameSession(session.id, "Manual title");
		const afterRename = await fixture.service.loadSessionSnapshot(session.id);

		expect(afterRename).toEqual(beforeRename);
		expect(fixture.service.getSession(session.id)).toMatchObject({
			title: "Manual title",
			titleSource: "manual",
		});

		const database = new DatabaseSync(join(fixture.dataRoot, "data.sqlite"));
		const tables = database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((row) => (row as { readonly name: string }).name);
		const counts = database
			.prepare(
				`SELECT
					(SELECT COUNT(*) FROM session_journals) AS journals,
					(SELECT COUNT(*) FROM session_journal_entries) AS entries,
					(SELECT COUNT(*) FROM desktop_session_metadata) AS metadata`,
			)
			.get() as { readonly journals: number; readonly entries: number; readonly metadata: number };
		database.close();

		expect(tables).toEqual(["desktop_session_metadata", "projects", "session_journal_entries", "session_journals"]);
		expect(counts).toEqual({ journals: 1, entries: 0, metadata: 1 });
	});

	test("Desktop 可以列出 CLI 通过另一条 SQLite 连接写入的通用 journal session", async () => {
		const fixture = await createFixture([]);
		const cliStore = await SqliteSessionStore.open<JsonObject>(join(fixture.dataRoot, "data.sqlite"));
		try {
			await cliStore.create("cli-session", emptyPersistedCodingSessionState<JsonObject>());
		} finally {
			cliStore.close();
		}

		expect(fixture.service.listSessions().sessions).toEqual([
			expect.objectContaining({
				id: "cli-session",
				projectId: null,
				title: "New session",
				titleSource: "fallback",
			}),
		]);
	});

	test("创建 Project 与 Session，并解析 execution context", async () => {
		const fixture = await createFixture(["project-1", "session-1"]);
		const folder = join(fixture.root, "project");
		await mkdir(folder);

		const project = await fixture.service.createProject({ path: folder, displayName: "Project" });
		const canonicalFolder = await realpath(folder);
		const session = await fixture.service.createSession({
			projectId: project.id,
			firstMessage: "  Implement   the feature  ",
			appState: { selected: true },
		});

		expect(session).toMatchObject({
			id: "session-1",
			projectId: "project-1",
			title: "Implement the feature",
			titleSource: "fallback",
		});
		expect((await fixture.service.loadSessionSnapshot(session.id)).appState).toEqual({
			version: 1,
			appState: { selected: true },
			extensions: {},
		});
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({
			localFileAccess: true,
			cwd: canonicalFolder,
			configRoot: canonicalFolder,
			defaultAllowedDirectories: [canonicalFolder],
		});
	});

	test("未归属 Session 没有本地文件 capability", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({ firstMessage: "" });

		expect(session).toMatchObject({ title: "New session", projectId: null });
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({ localFileAccess: false });
	});

	test("删除 Session 会删除同一数据库中的 journal 与 metadata", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({ firstMessage: "Delete me" });

		await fixture.service.deleteSession(session.id);

		expect(fixture.service.listSessions().sessions).toEqual([]);
		expect(await fixture.service.sessionStore.load(session.id)).toBeUndefined();
		const database = new DatabaseSync(join(fixture.dataRoot, "data.sqlite"));
		const count = database
			.prepare("SELECT COUNT(*) AS count FROM desktop_session_metadata WHERE session_id = ?")
			.get(session.id) as { readonly count: number };
		database.close();
		expect(count.count).toBe(0);
	});

	test("从 SQLite journal 恢复 snapshot", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({
			firstMessage: "Persist",
			appState: { selected: true },
		});
		const handle = await openSession(fixture.service.sessionStore, session.id, emptyPersistedCodingSessionState<JsonObject>());
		await handle.append({
			type: "message",
			id: "message-1",
			parentId: null,
			timestamp: "2026-08-01T00:00:00.000Z",
			message: { role: "user", content: "Persist", timestamp: 1 },
		});

		const snapshot = await fixture.service.loadSessionSnapshot(session.id);

		expect(snapshot.appState).toMatchObject({ appState: { selected: true } });
		expect(snapshot.entries).toEqual([
			expect.objectContaining({
				type: "message",
				message: { role: "user", content: "Persist", timestamp: 1 },
			}),
		]);
	});

	test("Desktop title metadata 与 agent app state 写入互不产生 revision conflict", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({ firstMessage: "Interleave" });
		const handle = await openSession(fixture.service.sessionStore, session.id, emptyPersistedCodingSessionState<JsonObject>());

		await handle.append({
			type: "app_state",
			id: "app-1",
			parentId: null,
			timestamp: "2026-08-01T00:00:01.000Z",
			value: {
				version: 1,
				appState: { todos: { version: 1, updatedAt: 1, items: [{ id: "t1", content: "Work", status: "pending" }] } },
				extensions: {},
			},
		});
		fixture.service.setGeneratedTitle(session.id, "Interleaved work");
		await handle.append({
			type: "app_state",
			id: "app-2",
			parentId: "app-1",
			timestamp: "2026-08-01T00:00:03.000Z",
			value: {
				version: 1,
				appState: { todos: { version: 1, updatedAt: 3, items: [{ id: "t1", content: "Work", status: "completed" }] } },
				extensions: {},
			},
		});

		expect(fixture.service.getSession(session.id)).toMatchObject({
			title: "Interleaved work",
			titleSource: "generated",
		});
		expect((await fixture.service.loadSessionSnapshot(session.id)).appState).toMatchObject({
			appState: { todos: { items: [{ id: "t1", status: "completed" }] } },
		});
	});

	test("移动 Session 只更新 Desktop metadata 与 execution context", async () => {
		const fixture = await createFixture(["project-1", "project-2", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const first = await fixture.service.createProject({ path: firstFolder });
		const second = await fixture.service.createProject({ path: secondFolder });
		const session = await fixture.service.createSession({ projectId: first.id, firstMessage: "Move me" });

		const moved = await fixture.service.moveSession({ sessionId: session.id, toProjectId: second.id });

		expect(moved.projectId).toBe(second.id);
		expect((await fixture.service.loadSessionSnapshot(session.id)).entries).toEqual([]);
		expect(await fixture.service.resolveExecutionContext(session.id)).toMatchObject({
			localFileAccess: true,
			cwd: await realpath(secondFolder),
		});
	});

	test("Relink 保留 Project identity，Folder 不可用时 fail closed", async () => {
		const fixture = await createFixture(["project-1", "session-1"]);
		const firstFolder = join(fixture.root, "first");
		const secondFolder = join(fixture.root, "second");
		await Promise.all([mkdir(firstFolder), mkdir(secondFolder)]);
		const project = await fixture.service.createProject({ path: firstFolder });
		const session = await fixture.service.createSession({ projectId: project.id, firstMessage: "Relink" });
		await rm(firstFolder, { recursive: true });
		expect(await fixture.service.resolveExecutionContext(session.id)).toEqual({ localFileAccess: false });

		const relinked = await fixture.service.relinkProject(project.id, { path: secondFolder });
		const canonicalSecondFolder = await realpath(secondFolder);

		expect(relinked).toMatchObject({ id: project.id, canonicalPath: canonicalSecondFolder });
		expect(await fixture.service.resolveExecutionContext(session.id)).toMatchObject({
			localFileAccess: true,
			cwd: canonicalSecondFolder,
		});
	});

	test("手动标题不会被迟到的自动标题覆盖", async () => {
		const fixture = await createFixture(["session-1"]);
		const session = await fixture.service.createSession({ firstMessage: "Fallback" });
		fixture.service.markTitleGenerationAttempted(session.id);
		fixture.service.renameSession(session.id, "Manual");

		expect(fixture.service.setGeneratedTitle(session.id, "Generated")).toMatchObject({
			title: "Manual",
			titleSource: "manual",
		});
	});

	test("Recents 使用稳定 keyset pagination", async () => {
		const fixture = await createFixture(["session-1", "session-2", "session-3"]);
		await fixture.service.createSession({ firstMessage: "one" });
		await fixture.service.createSession({ firstMessage: "two" });
		await fixture.service.createSession({ firstMessage: "three" });

		const first = fixture.service.listSessions({ limit: 2 });
		const second = fixture.service.listSessions({ limit: 2, cursor: first.nextCursor });

		expect(first.sessions.map((session) => session.id)).toEqual(["session-3", "session-2"]);
		expect(second.sessions.map((session) => session.id)).toEqual(["session-1"]);
		expect(second.nextCursor).toBeUndefined();
	});
});

async function createFixture(ids: string[]) {
	const root = await mkdtemp(join(tmpdir(), "jai-business-"));
	roots.push(root);
	const dataRoot = join(root, "data");
	let now = 1000;
	const service = await DesktopSessionCatalog.open({
		dataRoot,
		createId: () => {
			const id = ids.shift();
			if (!id) throw new Error("No fixture ID remains");
			return id;
		},
		now: () => now++,
	});
	services.push(service);
	return { root, dataRoot, service };
}
