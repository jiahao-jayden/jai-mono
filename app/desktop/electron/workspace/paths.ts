import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { TaggedError } from "better-result";

export class WorkspaceFileUnavailable extends TaggedError("desktop_workspace.file_unavailable")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

export class ArtifactPreviewUnavailable extends TaggedError("desktop_artifact.preview_unavailable")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

export const workspaceFileError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new WorkspaceFileUnavailable(init);

export const artifactPreviewError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new ArtifactPreviewUnavailable(init);

export const MAX_ARTIFACT_PREVIEW_BYTES = 1_000_000;
export const MAX_WORKSPACE_FILE_BYTES = 1_000_000;

/** True when `candidate` is `root` itself or sits underneath it. */
export function isInside(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * First half of the workspace path defense: rejects absolute paths and any `..`
 * segment before the value ever reaches the filesystem.
 */
export function assertWorkspaceRelativePath(value: string): string {
	const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
	if (normalized === "") return "";
	if (path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => part === ".." || part === "")) {
		throw workspaceFileError({ message: "Workspace path must stay inside the project." });
	}
	return normalized;
}

/**
 * Second half: resolves through symlinks and re-checks containment, so a link
 * pointing outside the project cannot escape it.
 */
export async function resolveWorkspacePath(
	projectRoot: string,
	relativePath: string,
	expectedKind: "directory" | "file",
): Promise<string> {
	try {
		const candidate = path.resolve(projectRoot, relativePath);
		const canonical = await realpath(candidate);
		if (!isInside(canonical, projectRoot))
			throw workspaceFileError({ message: "Workspace path is outside the project." });
		const info = await stat(canonical);
		if ((expectedKind === "directory" && !info.isDirectory()) || (expectedKind === "file" && !info.isFile())) {
			throw workspaceFileError({ message: "Workspace path has the wrong type." });
		}
		return canonical;
	} catch (cause) {
		if (cause instanceof WorkspaceFileUnavailable) throw cause;
		throw workspaceFileError({ message: "Workspace path is unavailable.", cause });
	}
}

export async function resolveArtifactPath(projectRoot: string, artifactPath: string): Promise<string> {
	try {
		const candidate = path.resolve(projectRoot, artifactPath);
		const canonical = await realpath(candidate);
		if (!isInside(canonical, projectRoot)) {
			throw artifactPreviewError({ message: "Artifact preview is only available for files inside the project." });
		}
		const info = await stat(canonical);
		if (!info.isFile() || info.size > MAX_ARTIFACT_PREVIEW_BYTES) {
			throw artifactPreviewError({ message: "Artifact preview is unavailable for this file." });
		}
		return canonical;
	} catch (cause) {
		if (cause instanceof ArtifactPreviewUnavailable) throw cause;
		throw artifactPreviewError({ message: "Artifact preview is unavailable for this file.", cause });
	}
}
