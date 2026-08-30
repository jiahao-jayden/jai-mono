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

	test("enforces referential integrity and reports catalog conflicts as typed failures", async () => {
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

			const absentProject = catalog.moveSession({ sessionId: "session-1", projectId: "missing" });
			expect(absentProject.isErr()).toBe(true);
			if (absentProject.isOk()) throw new Error("Expected missing Desktop project");
			expect(absentProject.error._tag).toBe("desktop_catalog.project_not_found");
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
