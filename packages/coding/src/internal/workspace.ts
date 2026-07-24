import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface WorkspacePathOptions {
	mustExist: boolean;
	expectedType?: "file" | "directory";
	allowOutsideWorkspace?: boolean;
}

async function resolveExistingAncestor(target: string): Promise<string> {
	const missingSegments: string[] = [];
	let current = target;

	while (true) {
		try {
			return join(await realpath(current), ...missingSegments);
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
				throw error;
			}

			const parent = dirname(current);
			if (parent === current) throw error;
			missingSegments.unshift(basename(current));
			current = parent;
		}
	}
}

function isWithinRoot(root: string, target: string): boolean {
	const pathFromRoot = relative(root, target);
	return (
		pathFromRoot === "" ||
		(!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
	);
}

export async function resolveWorkspacePath(
	root: string,
	input: string,
	options: WorkspacePathOptions,
): Promise<string> {
	if (input.length === 0) throw new Error("Path cannot be empty");
	if (input.includes("\0")) throw new Error("Path cannot contain NUL");

	const realRoot = await realpath(resolve(root));
	const rootStats = await stat(realRoot);
	if (!rootStats.isDirectory()) throw new Error(`Workspace root is not a directory: ${root}`);

	const requested = isAbsolute(input) ? resolve(input) : resolve(realRoot, input);
	let target: string;

	try {
		target = await realpath(requested);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		if (options.mustExist) throw new Error(`Path not found: ${input}`);
		target = await resolveExistingAncestor(requested);
	}

	if (!options.allowOutsideWorkspace && !isWithinRoot(realRoot, target)) {
		throw new Error(`Path escapes workspace: ${input}`);
	}

	try {
		const targetStats = await stat(target);
		if (options.expectedType === "file" && !targetStats.isFile()) {
			throw new Error(`Path is not a file: ${input}`);
		}
		if (options.expectedType === "directory" && !targetStats.isDirectory()) {
			throw new Error(`Path is not a directory: ${input}`);
		}
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		if (options.mustExist) throw new Error(`Path not found: ${input}`);
	}

	return target;
}
