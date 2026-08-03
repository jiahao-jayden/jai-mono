import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getErrorCode } from "@jai/common";
import type { ProviderModelInventory } from "@jai/coding/business";
import { ModelCatalogStore } from "@jai/coding/runtime";
import { DesktopProviderConfigService } from "../electron/provider-config";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopProviderConfigService", () => {
	test("原子保存 profile，但不向 renderer 投影 API key", async () => {
		const homeDir = await fixture();
		const service = new DesktopProviderConfigService({ homeDir, environment: {}, inventory: new TestInventory() });

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
			{ id: "openai", catalogProvider: "openai", adapter: "openai-compatible", baseURL: "" },
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
		const service = new DesktopProviderConfigService({ homeDir, environment: {}, inventory: new TestInventory() });
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
		const service = new DesktopProviderConfigService({
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

	test("重命名 profile 时迁移 inventory 并保留已保存凭证", async () => {
		const homeDir = await fixture();
		const service = new DesktopProviderConfigService({ homeDir, environment: {}, inventory: new TestInventory() });
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
