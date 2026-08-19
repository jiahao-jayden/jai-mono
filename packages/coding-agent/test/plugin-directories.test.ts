import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverCodingAgentPluginDirectories } from "../src/jai-host";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Coding Agent Plugin 默认目录发现", () => {
	test("按项目与用户优先级发现每个根目录的直接子插件", async () => {
		const home = await tempPath("home");
		const workspace = await tempPath("workspace");
		await createPlugin(path.join(workspace, ".jai", "plugins", "project-jai"));
		await createPlugin(path.join(workspace, ".agents", "plugins", "project-agents"));
		await createPlugin(path.join(home, ".jai", "plugins", "user-jai"));
		await createPlugin(path.join(home, ".agents", "plugins", "user-agents"));

		const directories = await discoverCodingAgentPluginDirectories({
			homeDirectory: home,
			workspaceDirectory: workspace,
			workspaceTrusted: true,
		});

		expect(directories).toEqual([
			{ path: path.join(workspace, ".jai", "plugins", "project-jai"), scope: "project" },
			{ path: path.join(workspace, ".agents", "plugins", "project-agents"), scope: "project" },
			{ path: path.join(home, ".jai", "plugins", "user-jai"), scope: "user" },
			{ path: path.join(home, ".agents", "plugins", "user-agents"), scope: "user" },
		]);
	});

	test("未信任工作区不加载项目插件，缺失目录与无 manifest 子目录会被忽略", async () => {
		const home = await tempPath("home");
		const workspace = await tempPath("workspace");
		await createPlugin(path.join(workspace, ".jai", "plugins", "project"));
		await createPlugin(path.join(home, ".agents", "plugins", "user"));
		await mkdir(path.join(home, ".jai", "plugins", "not-a-plugin"), { recursive: true });
		await mkdir(path.join(home, ".agents", "plugins", "nested", "plugin"), { recursive: true });
		await writeFile(path.join(home, ".agents", "plugins", "nested", "plugin", "plugin.json"), "{}");

		const directories = await discoverCodingAgentPluginDirectories({
			homeDirectory: home,
			workspaceDirectory: workspace,
			workspaceTrusted: false,
		});

		expect(directories).toEqual([{ path: path.join(home, ".agents", "plugins", "user"), scope: "user" }]);
	});
});

async function createPlugin(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(path.join(directory, "plugin.json"), "{}");
}

async function tempPath(name: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), `jai-coding-agent-plugin-${name}-`));
	roots.push(root);
	return root;
}
