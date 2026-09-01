import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
	type AgentPluginsDirectory,
	type AgentPluginsExtension,
	createAgentPluginsExtension,
} from "@jai/extension/agent-plugins";

/**
 * Product capability policy for Agent Plugins. User roots are always explicit;
 * project roots enter only when the Runtime Host has already resolved the
 * canonical workspace through its durable Workspace trust facts. ACP `cwd`
 * alone is never a capability grant.
 */
export async function discoverRuntimeAgentPluginDirectories(
	options: {
		readonly homeDirectory?: string;
		/** Canonical root supplied only after the Runtime Host reads a durable trust fact. */
		readonly trustedWorkspacePath?: string;
	} = {},
): Promise<readonly AgentPluginsDirectory[]> {
	const homeDirectory = path.resolve(options.homeDirectory ?? homedir());
	const projectRoots = options.trustedWorkspacePath
		? [
				path.join(options.trustedWorkspacePath, ".jai", "plugins"),
				path.join(options.trustedWorkspacePath, ".agents", "plugins"),
			]
		: [];
	const userRoots = [path.join(homeDirectory, ".jai", "plugins"), path.join(homeDirectory, ".agents", "plugins")];
	const [project, user] = await Promise.all([
		discoverPluginDirectories(projectRoots, "project"),
		discoverPluginDirectories(userRoots, "user"),
	]);
	return [...project, ...user];
}

export async function createRuntimeAgentPluginsExtension(input: {
	readonly dataDirectory: string;
	readonly homeDirectory?: string;
	/** Canonical root supplied only after the Runtime Host reads a durable trust fact. */
	readonly trustedWorkspacePath?: string;
}): Promise<AgentPluginsExtension> {
	const directories = await discoverRuntimeAgentPluginDirectories(input);
	return createAgentPluginsExtension({
		directories,
		dataDirectory: input.dataDirectory,
	});
}

async function discoverPluginDirectories(
	roots: readonly string[],
	scope: AgentPluginsDirectory["scope"],
): Promise<readonly AgentPluginsDirectory[]> {
	const children = await Promise.all(roots.map(discoverPluginChildren));
	return children.flatMap((entries) => entries.map((entry) => ({ path: entry, scope })));
}

async function discoverPluginChildren(directory: string): Promise<readonly string[]> {
	const entries = (await readdir(directory, { withFileTypes: true }).catch(() => [])).toSorted((left, right) =>
		left.name.localeCompare(right.name),
	);
	const candidates = await Promise.all(
		entries.map(async (entry) => {
			const candidate = path.join(directory, entry.name);
			if (!entry.isDirectory() && !(entry.isSymbolicLink() && (await isDirectory(candidate)))) return undefined;
			const manifest = await stat(path.join(candidate, "plugin.json")).catch(() => undefined);
			return manifest?.isFile() ? candidate : undefined;
		}),
	);
	return candidates.filter((candidate): candidate is string => candidate !== undefined);
}

async function isDirectory(candidate: string): Promise<boolean> {
	return (await stat(candidate).catch(() => undefined))?.isDirectory() ?? false;
}
