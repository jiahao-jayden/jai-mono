import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getErrorCode } from "@jai/common";
import { ModelCatalogStore } from "@jai/coding/runtime";
import { DesktopProviderConfigService } from "../electron/provider-config";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("DesktopProviderConfigService", () => {
	test("原子保存 profile 与 active model，但不向 renderer 投影 API key", async () => {
		const homeDir = await fixture();
		const service = new DesktopProviderConfigService({ homeDir, environment: {} });

		const snapshot = await service.save({
			revision: null,
			activeModelRef: "openai/gpt-main",
			profiles: [
				{
					id: "openai",
					name: "OpenAI",
					adapter: "openai-compatible",
					baseURL: "https://api.openai.com/v1",
					authentication: "api-key",
					apiKey: "sk-secret-1234",
					models: [{ id: "gpt-main", name: "GPT Main", remoteModelId: "gpt-main" }],
				},
			],
		});

		expect(snapshot).toMatchObject({
			activeModelRef: "openai/gpt-main",
			profiles: [{ credentialConfigured: true, credentialMask: "•••• 1234" }],
		});
		expect(JSON.stringify(snapshot)).not.toContain("sk-secret");
		const document = await readFile(join(homeDir, ".jai", "settings.json"), "utf8");
		expect(document).toContain("sk-secret-1234");
		service.close();
	});

	test("未修改连接时保留 main-only credential，修改 endpoint 时要求重新输入", async () => {
		const homeDir = await fixture();
		const service = new DesktopProviderConfigService({ homeDir, environment: {} });
		const first = await service.save({
			revision: null,
			activeModelRef: "anthropic/claude",
			profiles: [
				{
					id: "anthropic",
					name: "Anthropic",
					adapter: "anthropic",
					baseURL: "https://api.anthropic.com",
					authentication: "api-key",
					apiKey: "secret-abcd",
					models: [{ id: "claude", name: "Claude", remoteModelId: "claude" }],
				},
			],
		});

		const preserved = await service.save({
			revision: first.revision,
			activeModelRef: "anthropic/claude",
			profiles: first.profiles.map(({ credentialConfigured: _configured, credentialMask: _mask, ...profile }) => profile),
		});
		expect(preserved.profiles[0]?.credentialConfigured).toBe(true);

		try {
			await service.save({
				revision: preserved.revision,
				activeModelRef: "anthropic/claude",
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

	test("保存 catalog 模型引用和 agent defaults 时不把 catalog 固化进用户配置", async () => {
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
		const service = new DesktopProviderConfigService({ homeDir, environment: {}, catalog });

		const snapshot = await service.save({
			revision: null,
			activeModelRef: "openai/gpt-test",
			language: "zh-CN",
			maxIterations: 8,
			reasoningEffort: "medium",
			profiles: [
				{
					id: "openai",
					name: "OpenAI",
					adapter: "openai-compatible",
					catalogProvider: "openai",
					baseURL: "https://api.openai.com/v1",
					authentication: "api-key",
					apiKey: "sk-secret-1234",
					models: [{ id: "gpt-test", name: "GPT Test", remoteModelId: "gpt-test", source: "catalog" }],
				},
			],
		});

		expect(snapshot).toMatchObject({
			activeModelRef: "openai/gpt-test",
			language: "zh-CN",
			maxIterations: 8,
			reasoningEffort: "medium",
			profiles: [{ catalogProvider: "openai", models: [{ source: "catalog", toolCall: true }] }],
		});
		const document = await readFile(join(homeDir, ".jai", "settings.json"), "utf8");
		const persisted = JSON.parse(document);
		expect(persisted.providers.openai.catalogProvider).toBe("openai");
		expect(persisted.providers.openai.models).toEqual({});
		expect(document).not.toContain('"name":"GPT Test"');
		service.close();
		catalog.close();
	});
});

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-desktop-provider-"));
	roots.push(root);
	return join(root, "home");
}
