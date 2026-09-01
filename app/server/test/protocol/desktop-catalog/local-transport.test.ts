import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	SqliteDesktopCatalogAccess,
	SqliteProductSessionPersistence,
} from "../../../src/persistence";
import { openLocalAcpV2Client } from "../../../src/protocol/acp-v2";
import {
	DesktopCatalogControl,
	openLocalDesktopCatalogControlServer,
} from "../../../src/protocol/desktop-catalog";

describe("Desktop Catalog local control transport", () => {
	test("serves Desktop Catalog records on a private channel without an ACP initialize handshake", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-desktop-catalog-"));
		const endpoint = join(directory, "desktop-catalog.sock");
		const database = new DatabaseSync(":memory:");
		try {
			const persistence = new SqliteProductSessionPersistence(database);
			const created = await persistence.create({
				id: "session-1",
				appState: {},
				runtimeConfiguration: { model: "test/model", mode: "manual" },
				cwd: "/workspace",
				createdAt: "2026-08-25T12:00:00.000Z",
			});
			if (created.isErr()) throw created.error;
			const catalog = new SqliteDesktopCatalogAccess(database);
			const opened = await openLocalDesktopCatalogControlServer({
				endpoint,
				control: new DesktopCatalogControl(catalog),
			});
			if (opened.isErr()) throw opened.error;
			const client = await openLocalAcpV2Client(endpoint);
			if (client.isErr()) throw client.error;
			try {
				const project = await client.value.request("jai/desktop-catalog/projects/create", {
					id: "project-1",
					displayName: "Workspace",
					path: "/workspace",
					canonicalPath: "/workspace",
					createdAt: 1,
					updatedAt: 1,
				});
				expect(project).toEqual(
					expect.objectContaining({
						value: expect.objectContaining({ id: "project-1", canonicalPath: "/workspace" }),
					}),
				);

				const ensured = await client.value.request("jai/desktop-catalog/sessions/ensure", {
					sessionId: "session-1",
					projectId: "project-1",
					title: "First task",
				});
				expect(ensured).toEqual(
					expect.objectContaining({
						value: expect.objectContaining({ id: "session-1", title: "First task", projectId: "project-1" }),
					}),
				);

				const listed = await client.value.request("jai/desktop-catalog/sessions/list", {});
				expect(listed).toEqual(
					expect.objectContaining({
						value: { sessions: [expect.objectContaining({ id: "session-1", title: "First task" })] },
					}),
				);
			} finally {
				await client.value.close();
				await opened.value.close();
			}
		} finally {
			database.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
