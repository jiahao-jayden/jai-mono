import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getErrorCode } from "@jai/common";
import type { ProviderModelInventory } from "../electron/data";
import { DesktopConfigService } from "../electron/config";
import { ModelCatalogStore } from "../electron/config/model-catalog";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopConfigService", () => {
	test("原子保存 profile，但不向 renderer 投影 API key", async () => {
		const homeDir = await fixture();
		const service = new DesktopConfigService({ homeDir, environment: {}, inventory: new TestInventory() });

		const snapshot = await service.save({
			revision: null,
			profiles: [
				{
					id: "openai",
					name: "OpenAI",
					adapter: "openai-compatible",
					baseURL: "https://api.openai.com/v1",
					authentication: "api-key",
					apiKey: "sk-secret-1234",
					models: [
						{
							id: "gpt-main",
							name: "GPT Main",
							remoteModelId: "gpt-main",
							source: "unverified",
							verified: false,
							enabled: true,
						},
						{
							id: "gpt-off",
							name: "GPT Off",
							remoteModelId: "gpt-off",
							source: "unverified",
							verified: false,
							enabled: false,
						},
					],
				},
			],
		});

		expect(snapshot).toMatchObject({
			profiles: [{ credentialConfigured: true, credentialMask: "•••• 1234" }],
		});
		expect(
			snapshot.providerPresets.map(({ id, catalogProvider, adapter, baseURL }) => ({
				id,
				catalogProvider,
				adapter,
				baseURL,
			})),
		).toEqual([
			{ id: "anthropic", catalogProvider: "anthropic", adapter: "anthropic", baseURL: "" },
			{ id: "openai", catalogProvider: "openai", adapter: "openai-responses", baseURL: "" },
			{
				id: "deepseek",
				catalogProvider: "deepseek",
				adapter: "openai-compatible",
				baseURL: "https://api.deepseek.com/v1",
			},
			{
				id: "minimax",
				catalogProvider: "minimax",
				adapter: "openai-compatible",
				baseURL: "https://api.minimax.io/v1",
			},
			{
				id: "moonshot",
				catalogProvider: "moonshotai",
				adapter: "openai-compatible",
				baseURL: "https://api.moonshot.cn/v1",
			},
		]);
		expect(JSON.stringify(snapshot)).not.toContain("sk-secret");
		expect(await service.revealApiKey("openai")).toEqual({
			profileId: "openai",
			apiKey: "sk-secret-1234",
		});
		const document = await readFile(join(homeDir, ".jai", "settings.json"), "utf8");
		expect(document).toContain("sk-secret-1234");
		expect(JSON.parse(document).providers.openai.models).toEqual({ "gpt-main": { enabled: true } });
		service.close();
	});

	test("未修改连接时保留 main-only credential，修改 endpoint 时要求重新输入", async () => {
		const homeDir = await fixture();
		const service = new DesktopConfigService({ homeDir, environment: {}, inventory: new TestInventory() });
		const first = await service.save({
			revision: null,
			profiles: [
				{
					id: "anthropic",
					name: "Anthropic",
					adapter: "anthropic",
					baseURL: "https://api.anthropic.com",
					authentication: "api-key",
					apiKey: "secret-abcd",
					models: [
						{
							id: "claude",
							name: "Claude",
							remoteModelId: "claude",
							source: "unverified",
							verified: false,
							enabled: false,
						},
					],
				},
			],
		});

		const preserved = await service.save({
			revision: first.revision,
			profiles: first.profiles.map(({ credentialConfigured: _configured, credentialMask: _mask, ...profile }) => profile),
		});
		expect(preserved.profiles[0]?.credentialConfigured).toBe(true);

		try {
			await service.save({
				revision: preserved.revision,
				profiles: preserved.profiles.map(({ credentialConfigured: _configured, credentialMask: _mask, ...profile }) => ({
					...profile,
					baseURL: "https://anthropic.example.com",
				})),
			});
			throw new Error("Expected connection change to require a credential");
		} catch (error) {
			expect(getErrorCode(error)).toBe("desktop_provider_config.credential_required");
		}
		service.close();
	});

	test("保存模型启用状态和 agent defaults 时不把 catalog 固化进用户配置", async () => {
		const homeDir = await fixture();
		const catalog = new ModelCatalogStore({
			cachePath: join(homeDir, "catalog.json"),
			fetch: async () =>
				new Response(
					JSON.stringify({
						providers: {
							openai: {
								models: {
									"gpt-test": {
										name: "GPT Test",
										reasoning: true,
										tool_call: true,
										modalities: { input: ["text", "image"], output: ["text"] },
										cost: { input: 1, output: 2 },
										limit: { context: 128_000, output: 8_000 },
									},
								},
							},
						},
					}),
				),
		});
		await catalog.start();
		const service = new DesktopConfigService({
			homeDir,
			environment: {},
			catalog,
			inventory: new TestInventory(),
		});

		const snapshot = await service.save({
			revision: null,
			language: "zh-CN",
			maxIterations: 8,
			reasoningEffort: "medium",
			profiles: [
				{
					id: "gateway",
					name: "Gateway",
					adapter: "openai-compatible",
					baseURL: "https://gateway.example.com/v1",
					authentication: "api-key",
					apiKey: "sk-secret-1234",
					models: [
						{
							id: "gpt-test",
							name: "GPT Test",
							remoteModelId: "gpt-test",
							source: "catalog",
							verified: true,
							enabled: true,
							inputModalities: ["text", "image"],
							outputModalities: ["text"],
							toolCall: true,
							contextWindow: 128_000,
							maxTokens: 8_000,
						},
					],
				},
			],
		});

		expect(snapshot).toMatchObject({
			language: "zh-CN",
			maxIterations: 8,
			reasoningEffort: "medium",
			profiles: [{ id: "gateway", models: [] }],
		});
		const document = await readFile(join(homeDir, ".jai", "settings.json"), "utf8");
		const persisted = JSON.parse(document);
		expect(persisted.providers.gateway.catalogProvider).toBeUndefined();
		expect(persisted.providers.gateway.models).toEqual({ "gpt-test": { enabled: true } });
		expect(document).not.toContain('"name":"GPT Test"');
		service.close();
		catalog.close();
	});

	test("将已验证的 Desktop profile 投影为公开 SDK model/provider 输入", async () => {
		const homeDir = await fixture();
		const inventory = new TestInventory();
		const catalog = new ModelCatalogStore({
			cachePath: join(homeDir, "catalog.json"),
			fetch: async () =>
				new Response(
					JSON.stringify({
						providers: {
							openai: {
								models: {
									"gpt-test": {
										name: "GPT Test",
										tool_call: true,
										modalities: { input: ["text"], output: ["text"] },
										limit: { context: 128_000, output: 8_000 },
									},
								},
							},
						},
					}),
				),
		});
		await catalog.start();
		const service = new DesktopConfigService({ homeDir, environment: {}, catalog, inventory });
		await service.save({
			revision: null,
			maxIterations: 9,
			profiles: [
				{
					id: "gateway",
					name: "Gateway",
					adapter: "openai-compatible",
					baseURL: "https://gateway.example.com/v1",
					authentication: "api-key",
					apiKey: "gateway-secret",
					models: [
						{
							id: "gpt-test",
							name: "GPT Test",
							remoteModelId: "gpt-test",
							source: "catalog",
							verified: true,
							enabled: true,
							inputModalities: ["text"],
							outputModalities: ["text"],
							toolCall: true,
							contextWindow: 128_000,
							maxTokens: 8_000,
						},
					],
				},
			],
		});
		inventory.replaceProviderModelInventory("gateway", ["gpt-test"]);

		expect(await service.resolveAgentInput("gateway/gpt-test")).toEqual({
			model: "openai-compatible/gpt-test",
			provider: {
				apiKey: "gateway-secret",
				baseUrl: "https://gateway.example.com/v1",
				authentication: "bearer",
			},
			maxTurns: 9,
		});
		service.close();
		catalog.close();
	});

	test("重命名 profile 时迁移 inventory 并保留已保存凭证", async () => {
		const homeDir = await fixture();
		const service = new DesktopConfigService({ homeDir, environment: {}, inventory: new TestInventory() });
		const initial = await service.save({
			revision: null,
			profiles: [
				{
					id: "old",
					name: "Old",
					adapter: "openai-compatible",
					baseURL: "https://api.openai.com/v1",
					authentication: "api-key",
					apiKey: "sk-secret-1234",
					models: [
						{
							id: "gpt",
							name: "GPT",
							remoteModelId: "gpt",
							source: "unverified",
							verified: false,
							enabled: false,
						},
					],
				},
			],
		});

		const renamed = await service.save({
			revision: initial.revision,
			profiles: initial.profiles.map(({ credentialConfigured: _configured, credentialMask: _mask, ...profile }) => ({
				...profile,
				id: "new",
				previousId: "old",
			})),
		});

		expect(renamed.profiles).toMatchObject([{ id: "new", credentialConfigured: true, models: [{ id: "gpt" }] }]);
		service.close();
	});

	test("在 Settings 保存非 OAuth Connector credentials，但不投影明文", async () => {
		const homeDir = await fixture();
		const service = new DesktopConfigService({ homeDir, environment: {}, inventory: new TestInventory() });
		const first = await service.save({
			revision: null,
			profiles: [],
			connector: {
				policy: { default: "allow", actions: { "context7.search_libraries": "allow" } },
				connectors: [
					{
						id: "context7",
						enabled: true,
						credentials: { apiKey: "ctx-secret-1234" },
					},
				],
			},
		});
		expect(first.connector.connectors.find((connector) => connector.id === "context7")).toMatchObject({
			credentials: [{ key: "apiKey", configured: true, mask: "•••• 1234" }],
		});
		expect(JSON.stringify(first)).not.toContain("ctx-secret-1234");

		const preserved = await service.save({
			revision: first.revision,
			profiles: [],
			connector: {
				policy: { default: "allow", actions: { "context7.search_libraries": "allow" } },
				connectors: [{ id: "context7", enabled: true, credentials: {} }],
			},
		});
		expect(preserved.connector.connectors.find((connector) => connector.id === "context7")?.credentials[0]?.configured).toBe(
			true,
		);
		expect(preserved.connector.policy).toEqual({
			default: "allow",
			actions: { "context7.search_libraries": "allow" },
		});
		const document = await readFile(join(homeDir, ".jai", "settings.json"), "utf8");
		expect(document).toContain("ctx-secret-1234");
		service.close();
	});

	test("Extension Runtime adapter 为 Connector 与其他 Extension 分别持久化 user 配置", async () => {
		const homeDir = await fixture();
		const service = new DesktopConfigService({ homeDir, environment: {}, inventory: new TestInventory() });
		const writes: unknown[] = [];
		const adapter = service.createExtensionRuntimeAdapter({
			requestApproval: async () => "deny",
			onConfigurationWritten: (input) => writes.push(input),
		});
		if (!adapter.writeConfiguration || !adapter.readConfiguration) throw new Error("Extension Runtime adapter is incomplete");

		const connector = await adapter.writeConfiguration({
			extensionId: "connector",
			scope: "user",
			value: {
				policy: { default: "ask", actions: { "github.create_issue": "allow" } },
				connectors: { github: { enabled: true, credentials: { token: "github-secret" } } },
			},
		});
		const other = await adapter.writeConfiguration({
			extensionId: "example-extension",
			scope: "user",
			value: { enabled: true, nested: { retries: 2 } },
		});

		expect(connector).toEqual({
			policy: { default: "ask", actions: { "github.create_issue": "allow" } },
			connectors: { github: { enabled: true, credentials: { token: "github-secret" } } },
		});
		expect(other).toEqual({ enabled: true, nested: { retries: 2 } });
		expect(await adapter.readConfiguration({ extensionId: "connector", scope: "user" })).toEqual(connector);
		expect(await adapter.readConfiguration({ extensionId: "example-extension", scope: "user" })).toEqual(other);
		expect(writes).toEqual([
			{ extensionId: "connector", scope: "user", value: connector },
			{ extensionId: "example-extension", scope: "user", value: other },
		]);

		await expect(adapter.readConfiguration({ extensionId: "example-extension", scope: "project" })).rejects.toThrow(
			"Project-scoped Extension configuration is unavailable in Desktop",
		);
		service.close();
	});

	test("OAuth Connector token 保存到 settings.json，但只向 renderer 投影连接状态", async () => {
		const homeDir = await fixture();
		const service = new DesktopConfigService({ homeDir, environment: {}, inventory: new TestInventory() });
		const snapshot = await service.saveConnectorOAuth("google_drive", {
			accessToken: "drive-access-secret",
			tokenType: "Bearer",
			refreshToken: "drive-refresh-secret",
			expiresIn: 3_600,
			scope: "https://www.googleapis.com/auth/drive.metadata.readonly",
		});
		const drive = snapshot.connector.connectors.find((connector) => connector.id === "google_drive");
		expect(drive?.oauth).toMatchObject({
			connected: true,
			scopes: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
		});
		expect(snapshot.connector.connectors.find((connector) => connector.id === "google_gmail")?.oauth?.connected).toBe(
			false,
		);
		expect(JSON.stringify(snapshot)).not.toContain("drive-access-secret");
		expect(JSON.stringify(snapshot)).not.toContain("drive-refresh-secret");

		const document = JSON.parse(await readFile(join(homeDir, ".jai", "settings.json"), "utf8"));
		expect(document.connector.connectors.google_drive.credentials).toMatchObject({
			accessToken: "drive-access-secret",
			refreshToken: "drive-refresh-secret",
			tokenType: "Bearer",
		});

		const disconnected = await service.disconnectConnectorOAuth("google_drive");
		expect(disconnected.connector.connectors.find((connector) => connector.id === "google_drive")?.oauth?.connected).toBe(
			false,
		);
		const afterDisconnect = JSON.parse(await readFile(join(homeDir, ".jai", "settings.json"), "utf8"));
		expect(afterDisconnect.connector.connectors.google_drive.credentials).toBeUndefined();
		service.close();
	});
});

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-desktop-provider-"));
	roots.push(root);
	return join(root, "home");
}

class TestInventory {
	readonly #entries = new Map<string, ProviderModelInventory>();

	getProviderModelInventory(profileId: string): ProviderModelInventory | undefined {
		return this.#entries.get(profileId);
	}

	replaceProviderModelInventory(profileId: string, modelIds: readonly string[]): ProviderModelInventory {
		const entry = {
			profileId,
			modelIds: [...new Set(modelIds)].sort((left, right) => left.localeCompare(right)),
			fetchedAt: 1,
		};
		this.#entries.set(profileId, entry);
		return entry;
	}

	deleteProviderModelInventory(profileId: string): void {
		this.#entries.delete(profileId);
	}

	renameProviderModelInventory(fromProfileId: string, toProfileId: string): void {
		const entry = this.#entries.get(fromProfileId);
		if (!entry || fromProfileId === toProfileId) return;
		this.#entries.delete(fromProfileId);
		this.#entries.set(toProfileId, { ...entry, profileId: toProfileId });
	}
}
