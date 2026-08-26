import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDesktopCatalogClient } from "../../../src/desktop-catalog-client";
import { openConfiguredRuntimeHost } from "../../../src/runtime";

describe("Desktop Catalog client", () => {
	test("joins a running Runtime Host and uses only its private catalog control endpoint", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-desktop-catalog-client-"));
		const host = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "openai/example", JAI_VERSION: "test" },
			dataDirectory,
		});
		if (host.isErr()) throw host.error;
		try {
			const client = await connectDesktopCatalogClient({ dataDirectory, environment: {} });
			if (client.isErr()) throw client.error;
			try {
				const created = await client.value.createProject({
					id: "project-1",
					displayName: "Workspace",
					path: "/workspace",
					canonicalPath: "/workspace",
					createdAt: 1,
					updatedAt: 1,
				});
				if (created.isErr()) throw created.error;
				const listed = await client.value.listProjects();
				if (listed.isErr()) throw listed.error;
				expect(listed.value).toEqual([created.value]);
			} finally {
				await client.value.close();
			}
		} finally {
			await host.value.close();
			await rm(dataDirectory, { recursive: true, force: true });
		}
	});
});
