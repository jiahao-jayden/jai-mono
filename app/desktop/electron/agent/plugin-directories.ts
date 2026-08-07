import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentPluginDirectory } from "@jai/coding/agent-plugins";

export interface DesktopAgentPluginDirectoryOptions {
	readonly homeDirectory?: string;
	readonly workspaceDirectory?: string;
	readonly workspaceTrusted: boolean;
}

/**
 * 从内置 Skill catalog 使用的用户级和项目级根目录发现已安装插件。
 * 每个根目录只扫描一层，包加载和协议校验仍由 @jai/coding 负责。
 */
export async function discoverDesktopAgentPluginDirectories(
	options: DesktopAgentPluginDirectoryOptions,
): Promise<readonly AgentPluginDirectory[]> {
	const homeDirectory = path.resolve(options.homeDirectory ?? homedir());
	const roots: Array<{ readonly directory: string; readonly scope: "user" | "project" }> = [];
	if (options.workspaceTrusted && options.workspaceDirectory) {
		const workspaceDirectory = path.resolve(options.workspaceDirectory);
		roots.push(
			{ directory: path.join(workspaceDirectory, ".jai", "plugins"), scope: "project" },
			{ directory: path.join(workspaceDirectory, ".agents", "plugins"), scope: "project" },
		);
	}
	roots.push(
		{ directory: path.join(homeDirectory, ".jai", "plugins"), scope: "user" },
		{ directory: path.join(homeDirectory, ".agents", "plugins"), scope: "user" },
	);

	const directories: AgentPluginDirectory[] = [];
	for (const root of roots) {
		for (const directory of await discoverPluginChildren(root.directory)) {
			directories.push({ path: directory, scope: root.scope });
		}
	}
	return directories;
}

async function discoverPluginChildren(directory: string): Promise<readonly string[]> {
	const entries = (await readdir(directory, { withFileTypes: true }).catch(() => [])).toSorted((left, right) =>
		left.name.localeCompare(right.name),
	);
	const candidates: string[] = [];
	for (const entry of entries) {
		const candidate = path.join(directory, entry.name);
		const candidateInfo = await stat(candidate).catch(() => undefined);
		if (!candidateInfo?.isDirectory()) continue;
		const manifestInfo = await stat(path.join(candidate, "plugin.json")).catch(() => undefined);
		if (manifestInfo?.isFile()) candidates.push(candidate);
	}
	return candidates;
}
