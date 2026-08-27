import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createRuntimeAgentPluginsExtension,
	discoverRuntimeAgentPluginDirectories,
} from "../../src/agents";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Runtime Host Agent Plugins assembly", () => {
	test("discovers project plugins only when the Host passes an already-trusted workspace root", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "jai-runtime-agent-plugins-"));
		roots.push(root);
		const home = path.join(root, "home");
		await createPlugin(path.join(home, ".agents", "plugins", "user-plugin"), "user-plugin");
		await createPlugin(path.join(home, ".jai", "plugins", "another-user-plugin"), "another-user-plugin");
		await createPlugin(path.join(root, "workspace", ".jai", "plugins", "project-plugin"), "project-plugin");

		const untrusted = await discoverRuntimeAgentPluginDirectories({ homeDirectory: home });
		expect(untrusted).toEqual([
			{ path: path.join(home, ".jai", "plugins", "another-user-plugin"), scope: "user" },
			{ path: path.join(home, ".agents", "plugins", "user-plugin"), scope: "user" },
		]);
		const trusted = await discoverRuntimeAgentPluginDirectories({
			homeDirectory: home,
			trustedWorkspacePath: path.join(root, "workspace"),
		});
		expect(trusted).toEqual([
			{ path: path.join(root, "workspace", ".jai", "plugins", "project-plugin"), scope: "project" },
			{ path: path.join(home, ".jai", "plugins", "another-user-plugin"), scope: "user" },
			{ path: path.join(home, ".agents", "plugins", "user-plugin"), scope: "user" },
		]);

		const extension = await createRuntimeAgentPluginsExtension({
			homeDirectory: home,
			dataDirectory: path.join(root, "runtime-plugin-data"),
			trustedWorkspacePath: path.join(root, "workspace"),
		});
		expect(extension.id).toBe("agent-plugins");
		expect(extension.skillCards.map((skill) => skill.name)).toEqual([
			"project-plugin-skill",
			"another-user-plugin-skill",
			"user-plugin-skill",
		]);
	});
});

async function createPlugin(directory: string, name: string): Promise<void> {
	await mkdir(path.join(directory, "skills", `${name}-skill`), { recursive: true });
	await writeFile(
		path.join(directory, "plugin.json"),
		JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name, version: "1.0.0" }),
	);
	await writeFile(
		path.join(directory, "skills", `${name}-skill`, "SKILL.md"),
		`---\nname: ${name}-skill\ndescription: ${name} capability\n---\n\nInstructions\n`,
	);
}
