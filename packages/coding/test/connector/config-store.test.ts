import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorConfigConflict } from "@jai/connector";
import { createCodingConnectorConfigStore } from "../../src/connector";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Coding Connector config store", () => {
	test("persists Connector config and raw credentials in user settings", async () => {
		const homeDir = await mkdtemp(join(tmpdir(), "jai-coding-connector-config-"));
		roots.push(homeDir);
		const store = createCodingConnectorConfigStore({ homeDir, workspaceTrusted: true });

		const initial = await store.load();
		expect(initial.isOk()).toBe(true);
		if (initial.isErr()) return;

		const saved = await store.save(
			{
				connectors: {
					context7: {
						credentials: { apiKey: "context7-secret" },
					},
				},
			},
			{ expectedRevision: initial.value.revision },
		);
		expect(saved.isOk()).toBe(true);

		const document = JSON.parse(await readFile(join(homeDir, ".jai", "settings.json"), "utf8")) as Record<string, any>;
		expect(document.connector.connectors.context7.credentials.apiKey).toBe("context7-secret");
		expect(document.providers).toBeUndefined();
		store.close();
	});

	test("returns a conflict when a stale settings revision is used", async () => {
		const homeDir = await mkdtemp(join(tmpdir(), "jai-coding-connector-config-"));
		roots.push(homeDir);
		const store = createCodingConnectorConfigStore({ homeDir, workspaceTrusted: true });

		const initial = await store.load();
		if (initial.isErr()) return;
		const first = await store.save({ policy: { default: "ask" } }, { expectedRevision: initial.value.revision });
		if (first.isErr()) return;
		const stale = await store.save({}, { expectedRevision: initial.value.revision });

		expect(stale.isErr()).toBe(true);
		expect(stale.isErr() && stale.error instanceof ConnectorConfigConflict).toBe(true);
		store.close();
	});
});
