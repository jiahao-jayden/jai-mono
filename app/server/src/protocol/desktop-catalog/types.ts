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
