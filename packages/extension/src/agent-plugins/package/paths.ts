import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { AgentPluginLoadFailed } from "./errors";

export async function resolvePluginRoot(directory: string): Promise<string> {
	try {
		const root = await realpath(directory);
		const info = await stat(root);
		if (!info.isDirectory()) throw pluginPathError("root_unavailable", directory, "Plugin root is not a directory");
		return root;
	} catch (cause) {
		if (cause instanceof AgentPluginLoadFailed) throw cause;
		throw pluginPathError("root_unavailable", directory, "Plugin root is unavailable", cause);
	}
}

export async function containedPath(root: string, candidate: string, label: string): Promise<string> {
	const canonical = await realpath(candidate).catch((cause) => {
		throw pluginPathError("path_escape", candidate, `${label} cannot be resolved`, cause);
	});
	if (!isInside(canonical, root)) throw pluginPathError("path_escape", candidate, `${label} escapes Plugin root`);
	return canonical;
}

export function isInside(candidate: string, directory: string): boolean {
	const relative = path.relative(directory, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function pluginPathError(
	reason: "root_unavailable" | "path_escape",
	pathValue: string,
	message: string,
	cause?: unknown,
): AgentPluginLoadFailed {
	return new AgentPluginLoadFailed({ reason, path: pathValue, message, ...(cause === undefined ? {} : { cause }) });
}
