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
