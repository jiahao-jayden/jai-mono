import { homedir } from "node:os";
import path from "node:path";
import { projectPathInvalidError } from "./errors";

/** Sessions for workspaces that are not registered as a project. */
export const UNASSIGNED_DIRECTORY = "_unassigned";

/** Root holding every project's session storage. Hosts override the home directory only in tests. */
export function defaultCodingDataRoot(homeDirectory: string = homedir()): string {
	return path.join(homeDirectory, "jai", "projects");
}

export function projectDirectoryName(canonicalPath: string): string {
	const directory = path.basename(canonicalPath);
	if (!directory || directory === "." || directory === "..") {
		throw projectPathInvalidError(canonicalPath);
	}
	return directory;
}

/**
 * Session storage layout shared by every host, so sessions created by one are visible to the others.
 * `canonicalPath` is null for workspaces without a registered project.
 */
export function codingSessionDirectory(
	canonicalPath: string | null,
	dataRoot: string = defaultCodingDataRoot(),
): string {
	const directory = canonicalPath === null ? UNASSIGNED_DIRECTORY : projectDirectoryName(canonicalPath);
	return path.join(dataRoot, directory, "sessions");
}
