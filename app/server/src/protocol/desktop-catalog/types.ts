import type { Result } from "better-result";
import { TaggedError } from "better-result";

/** Desktop's durable title provenance; the Host stores but does not interpret it. */
export type DesktopCatalogTitleSource = "fallback" | "generated" | "manual";

/** A Desktop-owned workspace/project record projected through the local control channel. */
export interface DesktopCatalogProject {
	readonly id: string;
	readonly displayName: string;
	readonly path: string;
	readonly canonicalPath: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

/** Desktop-owned list metadata attached to an Agent Session Journal. */
export interface DesktopCatalogSession {
	readonly id: string;
	readonly projectId: string | null;
	readonly title: string;
	readonly titleSource: DesktopCatalogTitleSource;
	readonly lastActivityAt: number;
}

export interface DesktopCatalogSessionCursor {
	readonly lastActivityAt: number;
	readonly id: string;
}

export interface DesktopCatalogSessionPage {
	readonly sessions: readonly DesktopCatalogSession[];
	readonly nextCursor?: DesktopCatalogSessionCursor;
}

export class DesktopCatalogProjectNotFound extends TaggedError("desktop_catalog.project_not_found")<{
	readonly projectId: string;
	readonly message: string;
}> {}

export class DesktopCatalogSessionNotFound extends TaggedError("desktop_catalog.session_not_found")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

export class DesktopCatalogProjectPathConflict extends TaggedError("desktop_catalog.project_path_conflict")<{
	readonly canonicalPath: string;
	readonly message: string;
}> {}

export class DesktopCatalogStorageCorrupted extends TaggedError("desktop_catalog.storage_corrupted")<{
	readonly message: string;
}> {}

export class DesktopCatalogStorageFailed extends TaggedError("desktop_catalog.storage_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type DesktopCatalogStorageError =
	| DesktopCatalogProjectNotFound
	| DesktopCatalogSessionNotFound
	| DesktopCatalogProjectPathConflict
	| DesktopCatalogStorageCorrupted
	| DesktopCatalogStorageFailed;

/**
 * Narrow storage seam for Desktop-owned Catalog facts. Its inputs are already
 * canonicalized by Desktop policy; it supplies atomic persistence and referential
 * integrity without becoming a second Desktop domain implementation.
 */
export interface DesktopCatalogAccess {
	listProjects(): Result<readonly DesktopCatalogProject[], DesktopCatalogStorageError>;
	createProject(input: DesktopCatalogProject): Result<DesktopCatalogProject, DesktopCatalogStorageError>;
	relinkProject(input: DesktopCatalogProject): Result<DesktopCatalogProject, DesktopCatalogStorageError>;
	getProject(projectId: string): Result<DesktopCatalogProject | undefined, DesktopCatalogStorageError>;
	listSessions(input?: {
		readonly limit?: number;
		readonly cursor?: DesktopCatalogSessionCursor;
	}): Result<DesktopCatalogSessionPage, DesktopCatalogStorageError>;
	getSession(sessionId: string): Result<DesktopCatalogSession | undefined, DesktopCatalogStorageError>;
	deleteSession(sessionId: string): Result<void, DesktopCatalogStorageError>;
	ensureSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
		readonly title: string;
	}): Result<DesktopCatalogSession, DesktopCatalogStorageError>;
	renameSession(input: { readonly sessionId: string; readonly title: string }): Result<DesktopCatalogSession, DesktopCatalogStorageError>;
	markTitleGenerationAttempted(input: {
		readonly sessionId: string;
		readonly timestamp: number;
	}): Result<DesktopCatalogSession, DesktopCatalogStorageError>;
	setGeneratedTitle(input: { readonly sessionId: string; readonly title: string }): Result<DesktopCatalogSession, DesktopCatalogStorageError>;
	shouldGenerateSessionTitle(sessionId: string): Result<boolean, DesktopCatalogStorageError>;
	moveSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
	}): Result<DesktopCatalogSession, DesktopCatalogStorageError>;
}
