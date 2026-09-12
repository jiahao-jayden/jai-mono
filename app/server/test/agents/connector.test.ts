import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { createRuntimeConnectorAgentAssembly } from "../../src/agents";
import { SqliteRuntimeAgentSettings } from "../../src/config";
import type { CodingExtensionRuntime, JsonObject } from "@jai/coding-agent";
import { Result } from "better-result";

describe("Runtime Host Connector assembly", () => {
	test("keeps secrets out of Extension configuration and applies an always-allow policy to the live Connector service", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const initialized = settings.write({
				revision: null,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: true, credentials: { apiKey: "ctx-secret-1234" } } },
				},
			});
			if (initialized.isErr()) throw initialized.error;

			const assembled = createRuntimeConnectorAgentAssembly(settings);
			if (assembled.isErr()) throw assembled.error;
			const read = await assembled.value.extensionRuntime.readConfiguration?.({
				extensionId: "connector",
				scope: "user",
				workspace: { directory: "/workspace", trusted: true },
			});
			expect(read?.isOk()).toBe(true);
			if (!read || read.isErr()) throw read?.error;
			expect(read.value).toEqual({ policy: { default: "ask", actions: {} } });
			expect(JSON.stringify(read.value)).not.toContain("ctx-secret");

			const written = await assembled.value.extensionRuntime.writeConfiguration?.({
				extensionId: "connector",
				scope: "user",
				value: { policy: { default: "ask", actions: { "context7.search_libraries": "allow" } } },
			});
			expect(written?.isOk()).toBe(true);
			if (!written || written.isErr()) throw written?.error;

			const stored = settings.readConnectorSettings();
			if (stored.isErr()) throw stored.error;
			expect(stored.value.connectors?.context7?.credentials?.apiKey).toBe("ctx-secret-1234");
			expect(stored.value.policy?.actions?.["context7.search_libraries"]).toBe("allow");
		} finally {
			database.close();
		}
	});

	test("rejects connector credentials written through Extension configuration and keeps them in settings", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const initialized = settings.write({
				revision: null,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: true, credentials: { apiKey: "ctx-secret-1234" } } },
				},
			});
			if (initialized.isErr()) throw initialized.error;

			const assembled = createRuntimeConnectorAgentAssembly(settings);
			if (assembled.isErr()) throw assembled.error;
			const written = await assembled.value.extensionRuntime.writeConfiguration?.({
				extensionId: "connector",
				scope: "user",
				value: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: true, credentials: { apiKey: "stolen" } } },
				},
			});
			expect(written?.isErr()).toBe(true);

			const stored = settings.readConnectorSettings();
			if (stored.isErr()) throw stored.error;
			expect(stored.value.connectors?.context7?.credentials?.apiKey).toBe("ctx-secret-1234");
		} finally {
			database.close();
		}
	});

	test("settings write refreshes the live service so disabled connectors vanish from the catalog", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const initialized = settings.write({
				revision: null,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: true, credentials: { apiKey: "ctx-secret-1234" } } },
				},
			});
			if (initialized.isErr()) throw initialized.error;
			const revision = initialized.value.revision;

			const assembled = createRuntimeConnectorAgentAssembly(settings);
			if (assembled.isErr()) throw assembled.error;
			const extension = assembled.value.extensions[0]!;
			const catalog = extension.catalogs?.[0];
			if (!catalog?.subscribe) throw new Error("Connector catalog subscribe is unavailable");
			const runtime: CodingExtensionRuntime<JsonObject> = {
				sessionId: "session-1",
				cwd: "/workspace",
				workspace: { directory: "/workspace", trusted: true },
				permissionMode: "default",
				configuration: { value: {}, persistent: false, update: async () => Result.ok({}) },
				sessionState: { value: {}, update: async () => Result.ok({}) },
				requestApproval: async () => Result.ok("deny"),
				registerCommand: () => Result.ok({ unregister: () => {} }),
				instance: undefined,
			};

			const dispose = catalog.subscribe(runtime, () => {});
			expect(typeof dispose).toBe("function");
			if (typeof dispose !== "function") return;

			const before = await catalog.discover(runtime);
			expect(before.isOk()).toBe(true);
			if (before.isErr()) throw before.error;
			const context7Before = before.value.tools.filter((tool) => tool.name.startsWith("connector__context7__"));
			expect(context7Before.length).toBeGreaterThan(0);

			const disabled = settings.write({
				revision,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: false, credentials: { apiKey: "ctx-secret-1234" } } },
				},
			});
			expect(disabled.isOk()).toBe(true);

			const after = await catalog.discover(runtime);
			expect(after.isOk()).toBe(true);
			if (after.isErr()) throw after.error;
			const context7After = after.value.tools.filter((tool) => tool.name.startsWith("connector__context7__"));
			expect(context7After).toEqual([]);

			dispose();
		} finally {
			database.close();
		}
	});

	test("releasing the catalog subscription stops settings writes from refreshing the service", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = new SqliteRuntimeAgentSettings(database);
			const initialized = settings.write({
				revision: null,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: true, credentials: { apiKey: "ctx-secret-1234" } } },
				},
			});
			if (initialized.isErr()) throw initialized.error;
			let revision = initialized.value.revision;

			const assembled = createRuntimeConnectorAgentAssembly(settings);
			if (assembled.isErr()) throw assembled.error;
			const extension = assembled.value.extensions[0]!;
			const catalog = extension.catalogs?.[0];
			if (!catalog?.subscribe) throw new Error("Connector catalog subscribe is unavailable");
			const runtime: CodingExtensionRuntime<JsonObject> = {
				sessionId: "session-1",
				cwd: "/workspace",
				workspace: { directory: "/workspace", trusted: true },
				permissionMode: "default",
				configuration: { value: {}, persistent: false, update: async () => Result.ok({}) },
				sessionState: { value: {}, update: async () => Result.ok({}) },
				requestApproval: async () => Result.ok("deny"),
				registerCommand: () => Result.ok({ unregister: () => {} }),
				instance: undefined,
			};

			const dispose = catalog.subscribe(runtime, () => {});
			if (typeof dispose !== "function") throw new Error("subscribe did not return a disposer");

			const disabled = settings.write({
				revision,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: false, credentials: { apiKey: "ctx-secret-1234" } } },
				},
			});
			expect(disabled.isOk()).toBe(true);
			if (disabled.isErr()) throw disabled.error;
			revision = disabled.value.revision;

			const afterDisable = await catalog.discover(runtime);
			if (afterDisable.isErr()) throw afterDisable.error;
			const context7AfterDisable = afterDisable.value.tools.filter((tool) =>
				tool.name.startsWith("connector__context7__"),
			);
			expect(context7AfterDisable).toEqual([]);

			dispose();

			const reenabled = settings.write({
				revision,
				model: "",
				providers: [],
				connector: {
					policy: { default: "ask", actions: {} },
					connectors: { context7: { enabled: true, credentials: { apiKey: "ctx-secret-1234" } } },
				},
			});
			expect(reenabled.isOk()).toBe(true);

			const afterReenable = await catalog.discover(runtime);
			if (afterReenable.isErr()) throw afterReenable.error;
			const context7AfterReenable = afterReenable.value.tools.filter((tool) =>
				tool.name.startsWith("connector__context7__"),
			);
			expect(context7AfterReenable).toEqual([]);
		} finally {
			database.close();
		}
	});
});
