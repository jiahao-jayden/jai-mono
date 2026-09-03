import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	SqliteRuntimeAgentSettings,
	SqliteRuntimeModelCatalog,
	SqliteWorkspaceTrust,
	RuntimeTelemetryController,
} from "../../../src";
import { DesktopConfigurationControl } from "../../../src/protocol/desktop-configuration";

describe("Desktop configuration control", () => {
	test("projects telemetry safely and accepts only the telemetry write DTO", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-desktop-telemetry-control-"));
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const telemetry = await RuntimeTelemetryController.open({
				dataDirectory,
				database,
				environment: {},
				errorOutput: { write() {} },
			});
			if (telemetry.isErr()) throw telemetry.error;
			const control = new DesktopConfigurationControl(settings, undefined, undefined, undefined, telemetry.value);
			const saved = await control.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "jai/desktop-configuration/telemetry/save",
				params: {
					policyRevision: null,
					credentialRevision: null,
					enabled: true,
					exporter: "langfuse-otlp",
					endpoint: "https://langfuse.example/api/public/otel",
					publicKey: "pk-control-secret",
					secretKey: "sk-control-secret",
				},
			});
			expect(saved).toEqual([
				expect.objectContaining({
					id: 1,
					result: expect.objectContaining({
						credential: expect.objectContaining({ configured: true, publicKeyMask: "•••• cret" }),
					}),
				}),
			]);
			expect(JSON.stringify(saved)).not.toContain("pk-control-secret");
			expect(JSON.stringify(saved)).not.toContain("sk-control-secret");

			const invalid = await control.handle({
				jsonrpc: "2.0",
				id: 2,
				method: "jai/desktop-configuration/telemetry/save",
				params: { enabled: true, arbitrary: true },
			});
			expect(invalid).toEqual([
				{ jsonrpc: "2.0", id: 2, error: { code: -32602, message: "Invalid telemetry configuration save parameters" } },
			]);
			await telemetry.value.close();
		} finally {
			database.close();
			await rm(dataDirectory, { recursive: true, force: true });
		}
	});

	test("reveals Web Search credentials only for supported credential ids", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const saved = settings.write({
				revision: null,
				model: "",
				providers: [],
				webSearch: {
					providers: [{ id: "parallel", enabled: false, apiKey: "parallel-secret-1234" }],
				},
			});
			if (saved.isErr()) throw saved.error;
			const control = new DesktopConfigurationControl(settings);

			const revealed = await control.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "jai/desktop-configuration/reveal-web-search-api-key",
				params: { credentialId: "parallel" },
			});
			expect(revealed).toEqual([
				{
					jsonrpc: "2.0",
					id: 1,
					result: { credentialId: "parallel", apiKey: "parallel-secret-1234" },
				},
			]);

			const invalid = await control.handle({
				jsonrpc: "2.0",
				id: 2,
				method: "jai/desktop-configuration/reveal-web-search-api-key",
				params: { credentialId: "unknown" },
			});
			expect(invalid).toEqual([
				{
					jsonrpc: "2.0",
					id: 2,
					error: { code: -32602, message: "Invalid Web Search credential reveal parameters" },
				},
			]);
		} finally {
			database.close();
		}
	});

	test("reveals Connector and telemetry credentials only through explicit allowlisted requests", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-desktop-credential-control-"));
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const saved = settings.write({
				revision: null,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { credentials: { apiKey: "ctx-secret" } } },
				},
			});
			if (saved.isErr()) throw saved.error;
			const telemetry = await RuntimeTelemetryController.open({
				dataDirectory,
				database,
				environment: {},
				errorOutput: { write() {} },
			});
			if (telemetry.isErr()) throw telemetry.error;
			const configured = await telemetry.value.save({
				credentialRevision: null,
				enabled: false,
				exporter: "langfuse-otlp",
				policyRevision: null,
				publicKey: "pk-control",
				secretKey: "sk-control",
			});
			if (configured.isErr()) throw configured.error;
			const control = new DesktopConfigurationControl(settings, undefined, undefined, undefined, telemetry.value);

			const connector = await control.handle({
				jsonrpc: "2.0",
				id: 1,
				method: "jai/desktop-configuration/reveal-connector-credential",
				params: { connectorId: "context7", credentialKey: "apiKey" },
			});
			expect(connector).toEqual([
				{
					jsonrpc: "2.0",
					id: 1,
					result: { connectorId: "context7", credentialKey: "apiKey", value: "ctx-secret" },
				},
			]);

			const telemetryReveal = await control.handle({
				jsonrpc: "2.0",
				id: 2,
				method: "jai/desktop-configuration/telemetry/reveal-credential",
				params: { credentialId: "secret" },
			});
			expect(telemetryReveal).toEqual([
				{ jsonrpc: "2.0", id: 2, result: { credentialId: "secret", value: "sk-control" } },
			]);

			const invalid = await control.handle({
				jsonrpc: "2.0",
				id: 3,
				method: "jai/desktop-configuration/telemetry/reveal-credential",
				params: { credentialId: "unknown" },
			});
			expect(invalid).toEqual([
				{
					jsonrpc: "2.0",
					id: 3,
					error: { code: -32602, message: "Invalid telemetry credential reveal parameters" },
				},
			]);
			await telemetry.value.close();
		} finally {
			database.close();
			await rm(dataDirectory, { recursive: true, force: true });
		}
	});

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
			const control = new DesktopConfigurationControl(settings, undefined, catalog);
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
			const control = new DesktopConfigurationControl(settings, undefined, undefined, trust);
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
