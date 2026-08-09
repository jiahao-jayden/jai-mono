import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CodingConfigStore } from "../src/config";
import {
	codingAgentConfigDefinition,
	type CodingAgentSettings,
	normalizeModelCatalog,
	resolveConfiguredAgentRuntime,
	resolveConfiguredMcpServers,
	resolveConfiguredProvider,
} from "../src/runtime";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Provider configuration", () => {
	test("从 Settings 解析 MCP server，并补齐运行时默认字段", () => {
		const settings = {
			providers: {},
			mcp: {
				servers: {
					stdio: {
						type: "stdio",
						command: "npx",
						args: ["-y", "@modelcontextprotocol/server-everything@2026.7.4"],
					},
					streamable: {
						type: "streamable-http",
						url: "http://127.0.0.1:43121/mcp",
					},
					legacySse: {
						type: "sse",
						url: "http://127.0.0.1:43121/sse",
					},
				},
			},
			permissions: {},
		} satisfies CodingAgentSettings;

		expect(resolveConfiguredMcpServers(settings)).toEqual([
			{
				name: "stdio",
				type: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-everything@2026.7.4"],
				env: {},
			},
			{
				name: "streamable",
				type: "streamable-http",
				url: "http://127.0.0.1:43121/mcp",
				headers: {},
			},
			{
				name: "legacySse",
				type: "sse",
				url: "http://127.0.0.1:43121/sse",
				headers: {},
			},
		]);
	});

	test("Connector 配置只读取 user-global，项目配置不能扩大能力", async () => {
		const fixture = await createFixture();
		await writeSettings(join(fixture.homeDir, ".jai", "settings.json"), {
			connector: {
				policy: { default: "ask", actions: { "context7.get_documentation_context": "deny" } },
				connectors: { context7: { enabled: false } },
			},
		});
		await writeSettings(join(fixture.projectRoot, ".jai", "settings.json"), {
			connector: {
				policy: { default: "allow", actions: {} },
				connectors: { context7: { enabled: true } },
			},
		});

		const store = new CodingConfigStore(codingAgentConfigDefinition, {
			...fixture,
			workspaceTrusted: true,
		});
		const snapshot = await store.load();
		expect(snapshot.settings.connector?.policy?.default).toBe("ask");
		expect(snapshot.settings.connector?.policy?.actions).toEqual({
			"context7.get_documentation_context": "deny",
		});
		expect(snapshot.settings.connector?.connectors?.context7).toEqual({ enabled: false });
		store.close();
	});

	test("keeps the current Connector config schema at v1", () => {
		expect(codingAgentConfigDefinition.schemaVersion).toBe(1);
	});

	test("rejects removed Connector fields without a compatibility layer", async () => {
		const fixture = await createFixture();
		await writeSettings(join(fixture.homeDir, ".jai", "settings.json"), {
			connector: {
				enabled: false,
				providers: { context7: { defaultConnection: "docs" } },
			},
		});
		const store = new CodingConfigStore(codingAgentConfigDefinition, {
			...fixture,
			workspaceTrusted: true,
		});
		await expect(store.load()).rejects.toMatchObject({ _tag: "coding_config.validation_failed" });
		store.close();
	});

	test("rejects the removed Connector service process configuration", async () => {
		const fixture = await createFixture();
		await writeSettings(join(fixture.homeDir, ".jai", "settings.json"), {
			connector: {
				service: { mode: "managed", startup: "auto" },
			},
		});
		const store = new CodingConfigStore(codingAgentConfigDefinition, {
			...fixture,
			workspaceTrusted: true,
		});
		await expect(store.load()).rejects.toMatchObject({ _tag: "coding_config.validation_failed" });
		store.close();
	});

	test("resolves multiple named profiles using the same adapter", () => {
		const settings = {
			agent: { model: "work/gpt-main" },
			providers: {
				work: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "work-key",
					models: { "gpt-main": { remoteModelId: "gpt-remote", enabled: true } },
				},
				personal: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "personal-key",
					models: { "gpt-main": { enabled: true } },
				},
			},
			permissions: {},
		} satisfies CodingAgentSettings;

		const work = resolveConfiguredProvider(settings);
		const personal = resolveConfiguredProvider(settings, "personal/gpt-main");

		expect(work.provider.id).toBe("work");
		expect(work.model.remoteModelId).toBe("gpt-remote");
		expect(personal.provider.id).toBe("personal");
	});

	test("treats an omitted model enabled flag as disabled", () => {
		const settings = {
			agent: { model: "work/gpt-main" },
			providers: {
				work: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "work-key",
					models: { "gpt-main": {} },
				},
			},
			permissions: {},
		} satisfies CodingAgentSettings;

		expect(() => resolveConfiguredProvider(settings)).toThrow("is disabled");
	});

	test("does not inherit a lower-scope key when a project changes the connection tuple", async () => {
		const fixture = await createFixture();
		await writeSettings(join(fixture.homeDir, ".jai", "settings.json"), {
			agent: { model: "work/gpt-main" },
			providers: {
				work: {
					adapter: "openai-compatible",
					baseURL: "https://api.openai.com/v1",
					auth: "bearer",
					apiKey: "user-secret",
					models: { "gpt-main": { enabled: true } },
				},
			},
		});
		await writeSettings(join(fixture.projectRoot, ".jai", "settings.json"), {
			providers: {
				work: { baseURL: "https://project.example/v1" },
			},
		});
		const store = new CodingConfigStore(codingAgentConfigDefinition, {
			...fixture,
			workspaceTrusted: true,
		});
		const snapshot = await store.load();

		expect(() => resolveConfiguredProvider(snapshot.settings)).toThrow("requires an API key");
		store.close();
	});

	test("ignores project Provider overrides while the workspace is untrusted", async () => {
		const fixture = await createFixture();
		await writeSettings(join(fixture.homeDir, ".jai", "settings.json"), {
			agent: { model: "work/gpt-main" },
			providers: {
				work: {
					adapter: "openai-compatible",
					baseURL: "https://api.openai.com/v1",
					auth: "bearer",
					apiKey: "user-secret",
					models: { "gpt-main": { enabled: true } },
				},
			},
		});
		await writeSettings(join(fixture.projectRoot, ".jai", "settings.json"), {
			providers: {
				work: { baseURL: "https://project.example/v1" },
			},
		});
		const store = new CodingConfigStore(codingAgentConfigDefinition, {
			...fixture,
			workspaceTrusted: false,
		});
		const snapshot = await store.load();

		expect(snapshot.settings.providers.work?.baseURL).toBe("https://api.openai.com/v1");
		expect(resolveConfiguredProvider(snapshot.settings).provider.id).toBe("work");
		store.close();
	});

	test("uses a Models.dev baseline while keeping local connection secrets local", () => {
		const settings = {
			agent: { model: "work/gpt-main" },
			providers: {
				work: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "secret",
					catalogProvider: "openai",
					models: { "gpt-main": { enabled: true } },
				},
			},
			permissions: {},
		} satisfies CodingAgentSettings;
		const catalog = normalizeModelCatalog({
			providers: {
				openai: {
					models: {
						"gpt-main": {
							name: "GPT Main",
							reasoning: true,
							tool_call: true,
							structured_output: true,
							modalities: { input: ["text", "image"], output: ["text"] },
							cost: { input: 1, output: 2 },
							limit: { context: 200_000, output: 8_000 },
						},
					},
				},
			},
		});

		const resolved = resolveConfiguredProvider(settings, undefined, catalog);

		expect(resolved.model).toMatchObject({
			name: "GPT Main",
			reasoning: true,
			input: ["text", "image"],
			modalities: { input: ["text", "image"], output: ["text"] },
			capabilities: { toolCall: true, structuredOutput: true },
			contextWindow: 200_000,
			maxTokens: 8_000,
		});
		expect(
			resolveConfiguredProvider(settings, undefined, catalog, {
				availableModelIds: ["gpt-main"],
				requireVerifiedCapabilities: true,
			}).model,
		).toMatchObject({ contextWindow: 200_000, maxTokens: 8_000 });
	});

	test("refuses an unfetched, unverified, or tool-incompatible Coding Agent model", () => {
		const settings = {
			agent: { model: "work/custom" },
			providers: {
				work: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "secret",
					catalogProvider: "openai",
					models: {
						custom: { enabled: true, contextWindow: 128_000, maxTokens: 4_000, toolCall: true },
					},
				},
			},
			permissions: {},
		} satisfies CodingAgentSettings;

		expect(() =>
			resolveConfiguredProvider(settings, undefined, undefined, {
				availableModelIds: ["custom"],
				requireVerifiedCapabilities: true,
			}),
		).toThrow(/not verified/);
		expect(() =>
			resolveConfiguredProvider(settings, undefined, normalizeModelCatalog({
				providers: {
					openai: {
						models: {
							custom: {
								name: "Custom",
								tool_call: false,
								modalities: { input: ["text"], output: ["text"] },
								limit: { context: 128_000, output: 4_000 },
							},
						},
					},
				},
			}), {
				availableModelIds: ["custom"],
				requireVerifiedCapabilities: true,
			}),
		).toThrow(/requires verified text input\/output, tools, context, and output limits/);
		expect(() =>
			resolveConfiguredProvider(settings, undefined, normalizeModelCatalog({
				providers: {
					openai: {
						models: {
							custom: {
								name: "Custom",
								tool_call: true,
								modalities: { input: ["text"], output: ["text"] },
								limit: { context: 128_000, output: 4_000 },
							},
						},
					},
				},
			}), { requireVerifiedCapabilities: true }),
		).toThrow(/Fetch models/);
	});

	test("maps supported reasoning effort and rejects unsupported adapters", () => {
		const settings = {
			agent: { model: "work/gpt-main", reasoningEffort: "high", maxIterations: 12, language: "zh-CN" },
			providers: {
				work: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "secret",
					models: {
						"gpt-main": {
							enabled: true,
							reasoning: true,
							compatibility: { reasoningFormat: "openai" },
						},
					},
				},
			},
			permissions: {},
		} satisfies CodingAgentSettings;
		const resolved = resolveConfiguredProvider(settings);

		expect(resolveConfiguredAgentRuntime(settings, resolved)).toEqual({
			language: "zh-CN",
			maxIterations: 12,
			providerOptions: { work: { reasoning_effort: "high" } },
		});

		const unsupported = {
			...settings,
			agent: { ...settings.agent, reasoningEffort: "low" },
			providers: {
				work: {
					...settings.providers.work,
					models: {
						"gpt-main": {
							enabled: true,
							reasoning: true,
							compatibility: { reasoningFormat: "deepseek" },
						},
					},
				},
			},
		} satisfies CodingAgentSettings;
		expect(() => resolveConfiguredAgentRuntime(unsupported, resolveConfiguredProvider(unsupported))).toThrow(
			/does not support reasoning effort/,
		);

		const responses = {
			...settings,
			providers: {
				work: {
					...settings.providers.work,
					adapter: "openai-responses",
					models: { "gpt-main": { enabled: true, reasoning: true } },
				},
			},
		} satisfies CodingAgentSettings;
		const resolvedResponses = resolveConfiguredProvider(responses);
		expect(resolvedResponses.provider.adapter).toBe("openai-responses");
		expect(resolvedResponses.model.api).toBe("openai-responses");
		expect(resolveConfiguredAgentRuntime(responses, resolvedResponses).providerOptions).toEqual({
			work: { reasoning: { effort: "high", summary: "auto" } },
		});
	});
});

async function createFixture(): Promise<{ homeDir: string; projectRoot: string }> {
	const root = await mkdtemp(join(tmpdir(), "jai-provider-config-"));
	roots.push(root);
	const fixture = { homeDir: join(root, "home"), projectRoot: join(root, "project") };
	await Promise.all([mkdir(fixture.homeDir, { recursive: true }), mkdir(fixture.projectRoot, { recursive: true })]);
	return fixture;
}

async function writeSettings(path: string, settings: Record<string, unknown>): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({
			$schema: codingAgentConfigDefinition.schemaUrl,
			schemaVersion: codingAgentConfigDefinition.schemaVersion,
			...settings,
		})}\n`,
	);
}
