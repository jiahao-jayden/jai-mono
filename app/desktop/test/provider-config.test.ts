import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getErrorCode } from "@jai/common";
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
});

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "jai-desktop-provider-"));
	roots.push(root);
	return join(root, "home");
}
