import { homedir } from "node:os";
import path from "node:path";
import { TaggedError } from "better-result";

/** Sessions for workspaces that are not registered as a project. */
export const UNASSIGNED_DIRECTORY = "_unassigned";

class InvalidCodingDataPath extends TaggedError("jai_host.invalid_data_path")<{
	readonly message: string;
	readonly data: { readonly path: string };
}> {}

/** Root holding every project's session storage. Hosts override the home directory only in tests. */
export function defaultCodingDataRoot(homeDirectory: string = homedir()): string {
	return path.join(homeDirectory, "jai", "projects");
}

export function projectDirectoryName(canonicalPath: string): string {
	const directory = path.basename(canonicalPath);
	if (!directory || directory === "." || directory === "..") {
		throw new InvalidCodingDataPath({
			message: `Project path is not a usable directory name: ${canonicalPath}`,
			data: { path: canonicalPath },
		});
	}
	return directory;
}

/**
 * Session storage layout shared by Jai callers, so sessions created by one are visible to the others.
 * `canonicalPath` is null for workspaces without a registered project.
 */
export function codingSessionDirectory(
	canonicalPath: string | null,
	dataRoot: string = defaultCodingDataRoot(),
): string {
	const directory = canonicalPath === null ? UNASSIGNED_DIRECTORY : projectDirectoryName(canonicalPath);
	return path.join(dataRoot, directory, "sessions");
}
