import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductSqliteDatabase, SqliteDesktopCatalogAccess } from "../../src/persistence";
import { SqliteRuntimeAgentSettings } from "../../src/config";
import { connectDesktopConfigurationClient } from "../../src/desktop-configuration-client";
import { openLocalAcpV2Client } from "../../src/acp-client";
import { localDesktopCatalogEndpointFor } from "../../src/protocol/desktop-catalog";
import { localDesktopConfigurationEndpointFor } from "../../src/protocol/desktop-configuration";
import { SqliteProductSessionPersistence } from "../../src/persistence";
import { openConfiguredRuntimeHost } from "../../src/runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Runtime Host daemon composition", () => {
	test("opens an unconfigured Host so a Desktop client can save its first Provider profile", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const opened = await openConfiguredRuntimeHost({ environment: {}, dataDirectory });
		if (opened.isErr()) throw opened.error;
		try {
			const client = await connectDesktopConfigurationClient({ dataDirectory, environment: {} });
			if (client.isErr()) throw client.error;
			try {
				const snapshot = await client.value.get();
				if (snapshot.isErr()) throw snapshot.error;
				expect(snapshot.value).toEqual({
					revision: null,
					model: "",
					profiles: [],
					connector: { policy: { default: "ask", actions: {} }, connectors: [] },
				});
			} finally {
				await client.value.close();
			}
		} finally {
			await opened.value.close();
		}
	});

	test("serves Connector OAuth start and disconnect only through the local Host control endpoint", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const opened = await openConfiguredRuntimeHost({ dataDirectory, environment: {} });
		if (opened.isErr()) throw opened.error;
		try {
			const client = await connectDesktopConfigurationClient({ dataDirectory, environment: {} });
			if (client.isErr()) throw client.error;
			try {
				const initialized = await client.value.save({
					revision: null,
					model: "",
					providers: [],
					connector: { policy: { default: "ask", actions: {} }, connectors: { github: { enabled: true } } },
				});
				if (initialized.isErr()) throw initialized.error;
				const started = await client.value.startConnectorOAuth("github");
				if (started.isErr()) throw started.error;
				expect(started.value.connectorId).toBe("github");
				expect(started.value.authorizationUrl).toContain("/v1/oauth/github/authorize?");
				expect(started.value.authorizationUrl).toContain("code_challenge_method=S256");

				const snapshot = await client.value.get();
				if (snapshot.isErr()) throw snapshot.error;
				expect(snapshot.value.connector.connectors).toContainEqual({
					id: "github",
					enabled: true,
					credentials: [],
				});

				const disconnected = await client.value.disconnectConnectorOAuth("github");
				if (disconnected.isErr()) throw disconnected.error;
				expect(disconnected.value.connector.connectors).toContainEqual({
					id: "github",
					enabled: true,
					credentials: [],
				});
			} finally {
				await client.value.close();
			}
		} finally {
			await opened.value.close();
		}
	});

	test("opens one SQLite Runtime Host from environment-derived product configuration", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const endpoint = join(dataDirectory, "runtime.sock");
		const opened = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "openai/example", JAI_VERSION: "test" },
			dataDirectory,
			endpoint,
		});
		if (opened.isErr()) throw opened.error;

		expect(opened.value.endpoint).toBe(endpoint);
		expect(opened.value.desktopCatalogEndpoint).toBe(localDesktopCatalogEndpointFor(dataDirectory));
		expect(opened.value.desktopConfigurationEndpoint).toBe(localDesktopConfigurationEndpointFor(dataDirectory));
		await opened.value.close();
	});

	test("uses JAI_MODEL only to bootstrap and reopens from the stored model", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const first = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "openai/first", JAI_VERSION: "test" },
			dataDirectory,
			endpoint: join(dataDirectory, "first.sock"),
		});
		if (first.isErr()) throw first.error;
		await first.value.close();

		const reopened = await openConfiguredRuntimeHost({
			environment: { JAI_VERSION: "test" },
			dataDirectory,
			endpoint: join(dataDirectory, "reopened.sock"),
		});
		if (reopened.isErr()) throw reopened.error;
		await reopened.value.close();

		const database = await ProductSqliteDatabase.open(join(dataDirectory, "data.sqlite"));
		try {
			const settings = new SqliteRuntimeAgentSettings(database.connection).read();
			if (settings.isErr()) throw settings.error;
			expect(settings.value).toEqual({ model: "openai/first", providers: {}, extensions: {} });
		} finally {
			database.close();
		}
	});

	test("does not let a later JAI_MODEL override durable configuration", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const first = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "openai/first", JAI_VERSION: "test" },
			dataDirectory,
			endpoint: join(dataDirectory, "first.sock"),
		});
		if (first.isErr()) throw first.error;
		await first.value.close();

		const later = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "anthropic/later", JAI_VERSION: "test" },
			dataDirectory,
			endpoint: join(dataDirectory, "later.sock"),
		});
		if (later.isErr()) throw later.error;
		await later.value.close();

		const database = await ProductSqliteDatabase.open(join(dataDirectory, "data.sqlite"));
		try {
			const settings = new SqliteRuntimeAgentSettings(database.connection).read();
			if (settings.isErr()) throw settings.error;
			expect(settings.value).toEqual({ model: "openai/first", providers: {}, extensions: {} });
		} finally {
			database.close();
		}
	});

	test("creates the Coding Agent's versioned Session App State in the Runtime Host, not in a Client", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const opened = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "openai/example", JAI_VERSION: "test" },
			dataDirectory,
			endpoint: join(dataDirectory, "runtime.sock"),
		});
		if (opened.isErr()) throw opened.error;
		let sessionId: string;
		try {
			const client = await openLocalAcpV2Client(opened.value.endpoint);
			if (client.isErr()) throw client.error;
			try {
				const initialized = await client.value.request("initialize", {
					protocolVersion: 2,
					capabilities: {},
					info: { name: "test-client", version: "1.0.0" },
				});
				if (initialized.isErr()) throw initialized.error;
				const created = await client.value.request("session/new", { cwd: "/workspace" });
				if (created.isErr()) throw created.error;
				sessionId = (created.value as { readonly sessionId: string }).sessionId;
			} finally {
				await client.value.close();
			}
		} finally {
			await opened.value.close();
		}

		const persistence = await SqliteProductSessionPersistence.open(join(dataDirectory, "data.sqlite"));
		try {
			const stored = await persistence.load(sessionId!);
			if (stored.isErr()) throw stored.error;
			expect(stored.value.snapshot.initialAppState).toEqual({ version: 1, appState: {}, extensions: {} });
		} finally {
			persistence.close();
		}
	});

	test("keeps an ACP ephemeral Session out of the production SQLite and Desktop Catalog", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const opened = await openConfiguredRuntimeHost({
			environment: { JAI_MODEL: "openai/example", JAI_VERSION: "test" },
			dataDirectory,
			endpoint: join(dataDirectory, "runtime.sock"),
		});
		if (opened.isErr()) throw opened.error;
		let sessionId: string;
		try {
			const client = await openLocalAcpV2Client(opened.value.endpoint);
			if (client.isErr()) throw client.error;
			try {
				const initialized = await client.value.request("initialize", {
					protocolVersion: 2,
					capabilities: {},
					info: { name: "test-client", version: "1.0.0" },
				});
				if (initialized.isErr()) throw initialized.error;
				const created = await client.value.request("session/new", { cwd: "/workspace", ephemeral: true });
				if (created.isErr()) throw created.error;
				sessionId = (created.value as { readonly sessionId: string }).sessionId;
			} finally {
				await client.value.close();
			}
		} finally {
			await opened.value.close();
		}

		const database = await ProductSqliteDatabase.open(join(dataDirectory, "data.sqlite"));
		try {
			const persistence = new SqliteProductSessionPersistence(database.connection);
			const durable = await persistence.load(sessionId!);
			expect(durable.isErr()).toBe(true);
			const catalog = new SqliteDesktopCatalogAccess(database.connection).getSession(sessionId!);
			if (catalog.isErr()) throw catalog.error;
			expect(catalog.value).toBeUndefined();
		} finally {
			database.close();
		}
	});

	test("assembles user Agent Plugins into a live Host-owned Coding Agent operation", async () => {
		const dataDirectory = await mkdtemp(join(tmpdir(), "jai-runtime-daemon-"));
		temporaryDirectories.push(dataDirectory);
		const homeDirectory = join(dataDirectory, "home");
		const workspace = join(dataDirectory, "workspace");
		await mkdir(workspace, { recursive: true });
		await createPlugin(join(homeDirectory, ".jai", "plugins", "host-plugin"), "host-plugin");
		await createPlugin(join(workspace, ".jai", "plugins", "project-plugin"), "project-plugin");
		const providerRequests: unknown[] = [];
		const provider = Bun.serve({
			port: 0,
			fetch: async (request) => {
				providerRequests.push(await request.json());
				return new Response(anthropicTextEvents("Plugin capability assembled by Runtime Host"), {
					headers: { "content-type": "text/event-stream" },
				});
			},
		});
		const opened = await openConfiguredRuntimeHost({
			dataDirectory,
			homeDirectory,
			environment: {},
			endpoint: join(dataDirectory, "runtime.sock"),
		});
		if (opened.isErr()) throw opened.error;
		try {
			const configuration = await connectDesktopConfigurationClient({
				dataDirectory,
				runtimeEndpoint: opened.value.endpoint,
				environment: {},
			});
			if (configuration.isErr()) throw configuration.error;
			try {
				const saved = await configuration.value.save({
					revision: null,
					model: "local/test-model",
					providers: [
						{
							id: "local",
							name: "Local test provider",
							adapter: "anthropic",
							baseURL: provider.url.toString(),
							authentication: "api-key",
							apiKey: "test-key",
							enabled: true,
							models: [{ id: "test-model", enabled: true }],
						},
					],
				});
				if (saved.isErr()) throw saved.error;
				const trusted = await configuration.value.setWorkspaceTrust(workspace, true);
				if (trusted.isErr()) throw trusted.error;
			} finally {
				await configuration.value.close();
			}

			const client = await openLocalAcpV2Client(opened.value.endpoint);
			if (client.isErr()) throw client.error;
			const updates: unknown[] = [];
			const unsubscribe = client.value.subscribe((update) => updates.push(update));
			try {
				const initialized = await client.value.request("initialize", {
					protocolVersion: 2,
					capabilities: {},
					info: { name: "test-client", version: "1.0.0" },
				});
				if (initialized.isErr()) throw initialized.error;
				const created = await client.value.request("session/new", { cwd: workspace });
				if (created.isErr()) throw created.error;
				const sessionId = (created.value as { readonly sessionId: string }).sessionId;
				const prompted = await client.value.request("session/prompt", {
					sessionId,
					prompt: [{ type: "text", text: "Verify the installed capability" }],
				});
				if (prompted.isErr()) throw prompted.error;

				await waitFor(
					() =>
						updates.some((update) => JSON.stringify(update).includes("Plugin capability assembled by Runtime Host")) &&
						updates.some((update) => JSON.stringify(update).includes('"state":"idle"')),
				);
			} finally {
				unsubscribe();
				await client.value.close();
			}

			expect(providerRequests).toHaveLength(1);
			const request = providerRequests[0] as { readonly tools?: readonly { readonly name?: string; readonly description?: string }[] };
			expect(request.tools).toContainEqual(
				expect.objectContaining({ name: "Skill", description: expect.stringContaining("host-plugin-skill") }),
			);
			expect(request.tools).toContainEqual(
				expect.objectContaining({ name: "Skill", description: expect.stringContaining("project-plugin-skill") }),
			);
		} finally {
			await opened.value.close();
			provider.stop(true);
		}
	});
});

async function createPlugin(directory: string, name: string): Promise<void> {
	await mkdir(join(directory, "skills", `${name}-skill`), { recursive: true });
	await writeFile(
		join(directory, "plugin.json"),
		JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name, version: "1.0.0" }),
	);
	await writeFile(
		join(directory, "skills", `${name}-skill`, "SKILL.md"),
		`---\nname: ${name}-skill\ndescription: ${name} capability\n---\n\nInstructions\n`,
	);
}

function anthropicTextEvents(text: string): string {
	return [
		sse("message_start", {
			type: "message_start",
			message: {
				id: "message-id",
				type: "message",
				role: "assistant",
				model: "test-model",
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 1, output_tokens: 0 },
			},
		}),
		sse("content_block_start", {
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		}),
		sse("content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text },
		}),
		sse("content_block_stop", { type: "content_block_stop", index: 0 }),
		sse("message_delta", {
			type: "message_delta",
			delta: { stop_reason: "end_turn", stop_sequence: null },
			usage: { output_tokens: 1 },
		}),
		sse("message_stop", { type: "message_stop" }),
	].join("");
}

function sse(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (condition()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for Runtime Host operation to settle");
}
