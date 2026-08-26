import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import {
	SqliteRuntimeAgentSettings,
	SqliteRuntimeModelCatalog,
	SqliteWorkspaceTrust,
} from "../../../src";
import { createDesktopConfigurationControl } from "../../../src/protocol/desktop-configuration";

describe("Desktop configuration control", () => {
	test("projects Host-owned Model Catalog metadata and never accepts a client cache", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const catalog = new SqliteRuntimeModelCatalog(database, {
				fetcher: async () =>
					new Response(
						JSON.stringify({
							providers: {
								openai: {
									models: { "gpt-test": { name: "GPT Test", tool_call: true, credentials: "must not escape" } },
								},
							},
						}),
					),
			});
			const control = createDesktopConfigurationControl(settings, undefined, catalog);
			const before = await control.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "jai/desktop-configuration/model-catalog/get",
				params: {},
			});
			expect(before).toEqual([{ jsonrpc: "2.0", id: 1, result: { stale: false, refreshed: false } }]);

			const refreshed = await control.handle({
				jsonrpc: "2.0",
				id: 2,
				method: "jai/desktop-configuration/model-catalog/refresh",
				params: {},
			});
			expect(refreshed).toEqual([
				expect.objectContaining({
					id: 2,
					result: expect.objectContaining({
						refreshed: true,
						catalog: expect.objectContaining({
							providers: expect.objectContaining({
								openai: expect.objectContaining({
									models: expect.objectContaining({ "gpt-test": expect.objectContaining({ name: "GPT Test" }) }),
								}),
							}),
						}),
					}),
				}),
			]),
			expect(JSON.stringify(refreshed)).not.toContain("must not escape");

			const invalid = await control.handle({
				jsonrpc: "2.0",
				id: 3,
				method: "jai/desktop-configuration/model-catalog/refresh",
				params: { catalog: {} },
			});
			expect(invalid).toEqual([
				{ jsonrpc: "2.0", id: 3, error: { code: -32602, message: "Invalid Runtime Model Catalog refresh parameters" } },
			]);
			catalog.close();
		} finally {
			database.close();
		}
	});

	test("reads and writes Host-owned Workspace trust without accepting a Client-relative path", async () => {
		const workspace = process.cwd();
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const trust = new SqliteWorkspaceTrust(database);
			const control = createDesktopConfigurationControl(settings, undefined, undefined, trust);
			const missing = await control.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "jai/desktop-configuration/workspace-trust/get",
				params: { workspacePath: workspace },
			});
			expect(missing).toEqual([{ jsonrpc: "2.0", id: 1, result: { workspacePath: workspace, trusted: false } }]);

			const trusted = await control.handle({
				jsonrpc: "2.0",
				id: 2,
				method: "jai/desktop-configuration/workspace-trust/set",
				params: { workspacePath: workspace, trusted: true },
			});
			expect(trusted).toEqual([
				expect.objectContaining({ id: 2, result: expect.objectContaining({ workspacePath: workspace, trusted: true }) }),
			]);

			const invalid = await control.handle({
				jsonrpc: "2.0",
				id: 3,
				method: "jai/desktop-configuration/workspace-trust/set",
				params: { workspacePath: "relative-workspace", trusted: true },
			});
			expect(invalid).toEqual([
				{ jsonrpc: "2.0", id: 3, error: { code: -32001, message: "Workspace trust requires an absolute workspace path" } },
			]);
		} finally {
			database.close();
		}
	});
});
