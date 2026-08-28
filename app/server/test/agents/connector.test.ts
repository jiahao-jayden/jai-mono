import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { createRuntimeConnectorAgentAssembly } from "../../src/agents";
import { SqliteRuntimeAgentSettings } from "../../src/config";

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

			const extension = assembled.value.extensions[0];
			const search = extension?.tools?.find((tool) => tool.name === "connector__search_actions");
			if (!search) throw new Error("Connector search tool was not assembled");
			const output = await search.execute(
				{ sessionId: "session" } as Parameters<typeof search.execute>[0],
				{ toolCallId: "tool-call", args: { connectorId: "context7" } },
			);
			const content = output.content[0];
			if (!content || content.type !== "text") throw new Error("Connector search result is not text");
			const actions = JSON.parse(content.text) as { readonly actions: readonly { readonly actionId: string; readonly policy: string }[] };
			expect(actions.actions.find((action) => action.actionId === "context7.search_libraries")?.policy).toBe("allow");

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
});
