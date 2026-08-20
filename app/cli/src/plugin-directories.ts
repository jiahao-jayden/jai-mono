import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface CliAgentPluginDirectory {
	readonly path: string;
	readonly scope: "user" | "project";
}

/**
 * CLI host policy for selecting plugin package roots. It deliberately mirrors
 * the documented Jai disk convention without taking a dependency on Desktop.
 */
export async function discoverCliAgentPluginDirectories(options: {
	readonly homeDirectory: string;
	readonly workspaceDirectory?: string;
	readonly workspaceTrusted: boolean;
}): Promise<readonly CliAgentPluginDirectory[]> {
	const homeDirectory = path.resolve(options.homeDirectory);
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

	const perRoot = await Promise.all(roots.map((root) => discoverPluginChildren(root.directory)));
	return perRoot.flatMap((children, index) =>
		children.map((directory) => ({ path: directory, scope: roots[index]!.scope })),
	);
}

async function discoverPluginChildren(directory: string): Promise<readonly string[]> {
	const entries = (await readdir(directory, { withFileTypes: true }).catch(() => [])).toSorted((left, right) =>
		left.name.localeCompare(right.name),
	);
	const candidates = await Promise.all(
		entries.map(async (entry) => {
			const candidate = path.join(directory, entry.name);
			if (!entry.isDirectory() && !(entry.isSymbolicLink() && (await isDirectory(candidate)))) return undefined;
			const manifestInfo = await stat(path.join(candidate, "plugin.json")).catch(() => undefined);
			return manifestInfo?.isFile() ? candidate : undefined;
		}),
	);
	return candidates.filter((candidate): candidate is string => candidate !== undefined);
}

async function isDirectory(candidate: string): Promise<boolean> {
	const info = await stat(candidate).catch(() => undefined);
	return info?.isDirectory() ?? false;
}
