import { homedir } from "node:os";
import path from "node:path";
import { TaggedError } from "better-result";

/** Sessions for workspaces that are not registered as a project. */
export const UNASSIGNED_DIRECTORY = "_unassigned";

class InvalidCodingDataPath extends TaggedError("desktop_data.invalid_path")<{
	readonly message: string;
	readonly data: { readonly path: string };
}> {}

/** Root holding every Desktop project's durable data. */
export function defaultDesktopDataRoot(homeDirectory: string = homedir()): string {
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
 * The Jai product's durable session layout. The CLI intentionally follows this
 * same on-disk convention through its own local adapter.
 */
export function desktopSessionDirectory(
	canonicalPath: string | null,
	dataRoot: string = defaultDesktopDataRoot(),
): string {
	const directory = canonicalPath === null ? UNASSIGNED_DIRECTORY : projectDirectoryName(canonicalPath);
	return path.join(dataRoot, directory, "sessions");
}
