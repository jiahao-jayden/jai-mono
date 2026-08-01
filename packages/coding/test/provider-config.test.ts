import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CodingConfigStore } from "../src/config";
import {
	codingAgentConfigDefinition,
	type CodingAgentSettings,
	resolveConfiguredProvider,
} from "../src/runtime";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Provider configuration", () => {
	test("resolves multiple named profiles using the same adapter", () => {
		const settings = {
			agent: { model: "work/gpt-main" },
			providers: {
				work: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "work-key",
					models: { "gpt-main": { remoteModelId: "gpt-remote" } },
				},
				personal: {
					adapter: "openai-compatible",
					auth: "bearer",
					apiKey: "personal-key",
					models: { "gpt-main": {} },
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
					models: { "gpt-main": {} },
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
					models: { "gpt-main": {} },
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
