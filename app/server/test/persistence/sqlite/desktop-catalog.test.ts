import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteDesktopCatalogAccess, SqliteProductSessionPersistence } from "../../../src/persistence";

const createdAt = "2026-08-25T12:00:00.000Z";

describe("SqliteDesktopCatalogAccess", () => {
	test("stores Desktop Catalog facts through the Host SQLite connection without placing them in the Session Journal", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			const created = await persistence.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "test/model", mode: "manual" },
				cwd: "/workspace",
				createdAt,
			});
			if (created.isErr()) throw created.error;

			const project = catalog.createProject({
				id: "project-1",
				displayName: "Workspace",
				path: "/workspace",
				canonicalPath: "/workspace",
				createdAt: 10,
				updatedAt: 10,
			});
			if (project.isErr()) throw project.error;

			const session = catalog.ensureSession({
				sessionId: "session-1",
				projectId: "project-1",
				title: "First task",
			});
			if (session.isErr()) throw session.error;
			expect(session.value).toMatchObject({
				id: "session-1",
				projectId: "project-1",
				title: "First task",
				titleSource: "fallback",
			});

			const renamed = catalog.renameSession({ sessionId: "session-1", title: "Manual title" });
			if (renamed.isErr()) throw renamed.error;
			expect(renamed.value).toMatchObject({ title: "Manual title", titleSource: "manual" });

			const generated = catalog.setGeneratedTitle({ sessionId: "session-1", title: "Ignored generated title" });
			if (generated.isErr()) throw generated.error;
			expect(generated.value).toMatchObject({ title: "Manual title", titleSource: "manual" });

			const journal = await persistence.load("session-1");
			if (journal.isErr()) throw journal.error;
			expect(journal.value.snapshot.entries).toEqual([]);
		} finally {
			database.close();
		}
	});

	test("does not expose journal-only child sessions in the Desktop session list", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			const parent = await persistence.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "test/model", mode: "manual" },
				cwd: "/workspace",
				createdAt,
			});
			if (parent.isErr()) throw parent.error;
			const child = await persistence.createJournalOnly({
				id: "session-1:tool-call-1",
				appState: {},
				createdAt,
			});
			if (child.isErr()) throw child.error;

			const listed = catalog.listSessions();
			if (listed.isErr()) throw listed.error;
			expect(listed.value.sessions.map((session) => session.id)).toEqual(["session-1"]);
			expect(catalog.getSession("session-1:tool-call-1")).toEqual(
				expect.objectContaining({ value: undefined }),
			);
		} finally {
			database.close();
		}
	});

	test("archives only Desktop metadata and lists archived Sessions on demand", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			const created = await persistence.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "test/model", mode: "manual" },
				cwd: "/workspace",
				createdAt,
			});
			if (created.isErr()) throw created.error;
			const project = catalog.createProject({
				id: "project-1",
				displayName: "Workspace",
				path: "/workspace",
				canonicalPath: "/workspace",
				createdAt: 10,
				updatedAt: 10,
			});
			if (project.isErr()) throw project.error;
			const ensured = catalog.ensureSession({ sessionId: "session-1", projectId: project.value.id, title: "Archive me" });
			if (ensured.isErr()) throw ensured.error;

			const archived = catalog.archiveSession("session-1");
			if (archived.isErr()) throw archived.error;

			expect(archived.value).toMatchObject({
				id: "session-1",
				projectId: "project-1",
				archivedAt: expect.any(Number),
			});
			expect(catalog.listSessions()).toEqual(expect.objectContaining({ value: { sessions: [] } }));
			expect(catalog.listSessions({ archived: true })).toEqual(
				expect.objectContaining({
					value: { sessions: [expect.objectContaining({ id: "session-1", archivedAt: expect.any(Number) })] },
				}),
			);
			const journal = await persistence.load("session-1");
			if (journal.isErr()) throw journal.error;
			expect(journal.value.cwd).toBe("/workspace");

			const restored = catalog.restoreSession("session-1");
			if (restored.isErr()) throw restored.error;

			expect(restored.value).toMatchObject({ id: "session-1", archivedAt: null });
			expect(catalog.listSessions()).toEqual(
				expect.objectContaining({ value: { sessions: [expect.objectContaining({ id: "session-1", archivedAt: null })] } }),
			);
		} finally {
			database.close();
		}
	});

	test("paginates archived Sessions by archive time rather than journal activity", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			const sessions = [
				{ id: "older-chat", createdAt: "2020-01-01T00:00:00.000Z", archivedAt: 10_000 },
				...Array.from({ length: 50 }, (_, index) => ({
					id: `chat-${String(index + 1).padStart(2, "0")}`,
					createdAt: "2026-08-25T12:00:00.000Z",
					archivedAt: index === 49 ? 9_951 : 10_000 - (index + 1),
				})),
			];
			for (const session of sessions) {
				const created = await persistence.create({
					id: session.id,
					appState: {},
					runtimeConfiguration: { model: "test/model", mode: "manual" },
					cwd: "/workspace",
					createdAt: session.createdAt,
				});
				if (created.isErr()) throw created.error;
				const ensured = catalog.ensureSession({ sessionId: session.id, projectId: null, title: session.id });
				if (ensured.isErr()) throw ensured.error;
				const archived = catalog.archiveSession(session.id);
				if (archived.isErr()) throw archived.error;
				database.prepare("UPDATE desktop_session_metadata SET archived_at = ? WHERE session_id = ?").run(
					session.archivedAt,
					session.id,
				);
			}

			const firstPage = catalog.listSessions({ archived: true, limit: 50 });
			if (firstPage.isErr()) throw firstPage.error;
			expect(firstPage.value.sessions).toHaveLength(50);
			expect(firstPage.value.sessions[0]?.id).toBe("older-chat");
			expect(firstPage.value.nextCursor).toEqual({ lastActivityAt: 9_951, id: "chat-50" });

			const secondPage = catalog.listSessions({ archived: true, limit: 50, cursor: firstPage.value.nextCursor });
			if (secondPage.isErr()) throw secondPage.error;
			expect(secondPage.value.sessions.map((session) => session.id)).toEqual(["chat-49"]);
			expect(secondPage.value.nextCursor).toBeUndefined();
		} finally {
			database.close();
		}
	});

	test("adds the archive column to an existing Desktop metadata table", () => {
		const database = new DatabaseSync(":memory:");
		try {
			database.exec(`
				CREATE TABLE desktop_session_metadata (
					session_id TEXT PRIMARY KEY,
					project_id TEXT,
					title TEXT NOT NULL,
					title_source TEXT NOT NULL,
					title_generation_attempted_at INTEGER
				);
			`);

			new SqliteDesktopCatalogAccess(database);

			const columns = database.prepare("PRAGMA table_info(desktop_session_metadata)").all() as {
				readonly name: string;
			}[];
			expect(columns.map((column) => column.name)).toContain("archived_at");
		} finally {
			database.close();
		}
	});

	test("relinks all associated Session workspaces without changing their Project", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			for (const sessionId of ["session-1", "session-2"]) {
				const created = await persistence.create({
					id: sessionId,
					appState: {},
					runtimeConfiguration: { model: "test/model", mode: "manual" },
					cwd: "/old-workspace",
					createdAt,
				});
				if (created.isErr()) throw created.error;
			}
			const project = {
				id: "project-1",
				displayName: "Workspace",
				path: "/old-workspace",
				canonicalPath: "/old-workspace",
				createdAt: 10,
				updatedAt: 10,
			};
			if (catalog.createProject(project).isErr()) throw new Error("Could not create Project");
			for (const sessionId of ["session-1", "session-2"]) {
				const ensured = catalog.ensureSession({ sessionId, projectId: project.id, title: sessionId });
				if (ensured.isErr()) throw ensured.error;
			}

			const relinked = catalog.relinkProject({
				...project,
				path: "/new-workspace",
				canonicalPath: "/new-workspace",
				updatedAt: 20,
			});
			if (relinked.isErr()) throw relinked.error;

			for (const sessionId of ["session-1", "session-2"]) {
				const session = await persistence.load(sessionId);
				if (session.isErr()) throw session.error;
				expect(session.value.cwd).toBe("/new-workspace");
				expect(catalog.getSession(sessionId)).toEqual(
					expect.objectContaining({ value: expect.objectContaining({ projectId: project.id }) }),
				);
			}
		} finally {
			database.close();
		}
	});

	test("rolls back the Project relink when an associated Session workspace cannot update", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			const created = await persistence.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "test/model", mode: "manual" },
				cwd: "/old-workspace",
				createdAt,
			});
			if (created.isErr()) throw created.error;
			const project = {
				id: "project-1",
				displayName: "Workspace",
				path: "/old-workspace",
				canonicalPath: "/old-workspace",
				createdAt: 10,
				updatedAt: 10,
			};
			if (catalog.createProject(project).isErr()) throw new Error("Could not create Project");
			const ensured = catalog.ensureSession({ sessionId: "session-1", projectId: project.id, title: "First" });
			if (ensured.isErr()) throw ensured.error;
			database.exec(`
				CREATE TRIGGER reject_session_workspace_relink
				BEFORE UPDATE OF cwd ON product_session_catalog
				BEGIN
					SELECT RAISE(ABORT, 'reject workspace relink');
				END;
			`);

			const relinked = catalog.relinkProject({
				...project,
				path: "/new-workspace",
				canonicalPath: "/new-workspace",
				updatedAt: 20,
			});

			expect(relinked.isErr()).toBe(true);
			expect(catalog.getProject(project.id)).toEqual(expect.objectContaining({ value: project }));
			const session = await persistence.load("session-1");
			if (session.isErr()) throw session.error;
			expect(session.value.cwd).toBe("/old-workspace");
			expect(catalog.getSession("session-1")).toEqual(
				expect.objectContaining({ value: expect.objectContaining({ projectId: project.id }) }),
			);
		} finally {
			database.close();
		}
	});

	test("reports catalog project conflicts as typed failures", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const catalog = new SqliteDesktopCatalogAccess(database);
			const project = {
				id: "project-1",
				displayName: "Workspace",
				path: "/workspace",
				canonicalPath: "/workspace",
				createdAt: 10,
				updatedAt: 10,
			};
			const first = catalog.createProject(project);
			if (first.isErr()) throw first.error;
			const duplicate = catalog.createProject({ ...project, id: "project-2" });
			expect(duplicate.isErr()).toBe(true);
			if (duplicate.isOk()) throw new Error("Expected Desktop project path conflict");
			expect(duplicate.error._tag).toBe("desktop_catalog.project_path_conflict");
		} finally {
			database.close();
		}
	});

	test("deletes a Session journal and its Desktop metadata through the Host-owned connection", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			const created = await persistence.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "test/model", mode: "manual" },
				cwd: "/workspace",
				createdAt,
			});
			if (created.isErr()) throw created.error;
			const ensured = catalog.ensureSession({ sessionId: "session-1", projectId: null, title: "Delete me" });
			if (ensured.isErr()) throw ensured.error;

			const deleted = catalog.deleteSession("session-1");
			if (deleted.isErr()) throw deleted.error;

			const missing = await persistence.load("session-1");
			expect(missing.isErr()).toBe(true);
			expect(catalog.getSession("session-1")).toEqual(expect.objectContaining({ value: undefined }));
		} finally {
			database.close();
		}
	});

	test("deletes a Session that already has admitted Operations", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const catalog = new SqliteDesktopCatalogAccess(database);
			const created = await persistence.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "test/model", mode: "manual" },
				cwd: "/workspace",
				createdAt,
			});
			if (created.isErr()) throw created.error;
			const admitted = await persistence.admitPrompt({
				sessionId: "session-1",
				inputEntry: {
					type: "message",
					id: "operation-1:input",
					parentId: null,
					timestamp: createdAt,
					message: { role: "user", content: "你好", timestamp: Date.parse(createdAt) },
				},
				operation: {
					type: "operation_accepted",
					operationId: "operation-1",
					kind: "prompt",
					inputEntryId: "operation-1:input",
					startLeafId: null,
					timestamp: createdAt,
				},
			});
			if (admitted.isErr()) throw admitted.error;
			const ensured = catalog.ensureSession({ sessionId: "session-1", projectId: null, title: "你好" });
			if (ensured.isErr()) throw ensured.error;

			const deleted = catalog.deleteSession("session-1");
			if (deleted.isErr()) throw deleted.error;

			const missing = await persistence.load("session-1");
			expect(missing.isErr()).toBe(true);
			expect(catalog.getSession("session-1")).toEqual(expect.objectContaining({ value: undefined }));
		} finally {
			database.close();
		}
	});
});
