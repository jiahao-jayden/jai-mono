import type { DatabaseSync } from "node:sqlite";
import { Result, type Result as ResultType } from "better-result";
import {
	type DesktopCatalogAccess,
	type DesktopCatalogProject,
	DesktopCatalogProjectNotFound,
	DesktopCatalogProjectPathConflict,
	type DesktopCatalogSession,
	type DesktopCatalogSessionCursor,
	DesktopCatalogSessionNotFound,
	type DesktopCatalogSessionPage,
	DesktopCatalogStorageCorrupted,
	type DesktopCatalogStorageError,
	DesktopCatalogStorageFailed,
	type DesktopCatalogTitleSource,
} from "../../protocol/desktop-catalog/types";

interface ProjectRow {
	readonly id: string;
	readonly display_name: string;
	readonly path: string;
	readonly canonical_path: string;
	readonly created_at: number;
	readonly updated_at: number;
}

interface SessionRow {
	readonly id: string;
	readonly project_id: string | null;
	readonly title: string;
	readonly title_source: string;
	readonly updated_at: string;
	readonly title_generation_attempted_at: number | null;
}

/**
 * SQLite storage for Desktop Catalog facts. It is created by the Runtime Host
 * with its process-owned connection; no Desktop process obtains this adapter.
 */
export class SqliteDesktopCatalogAccess implements DesktopCatalogAccess {
	constructor(private readonly database: DatabaseSync) {
		this.initialize();
	}

	listProjects(): ResultType<readonly DesktopCatalogProject[], DesktopCatalogStorageError> {
		try {
			const rows = this.database
				.prepare(
					`SELECT id, display_name, path, canonical_path, created_at, updated_at
					 FROM projects ORDER BY created_at ASC, id ASC`,
				)
				.all() as unknown as ProjectRow[];
			return Result.ok(rows.map(projectRow));
		} catch (cause) {
			return Result.err(this.failed("Could not list Desktop projects", cause));
		}
	}

	createProject(input: DesktopCatalogProject): ResultType<DesktopCatalogProject, DesktopCatalogStorageError> {
		try {
			this.database
				.prepare(
					`INSERT INTO projects (id, display_name, path, canonical_path, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.run(input.id, input.displayName, input.path, input.canonicalPath, input.createdAt, input.updatedAt);
			return Result.ok(input);
		} catch (cause) {
			if (isUniqueViolation(cause)) {
				return Result.err(
					new DesktopCatalogProjectPathConflict({
						message: `Desktop project path "${input.canonicalPath}" is already cataloged`,
						canonicalPath: input.canonicalPath,
					}),
				);
			}
			return Result.err(this.failed(`Could not create Desktop project "${input.id}"`, cause));
		}
	}

	relinkProject(input: DesktopCatalogProject): ResultType<DesktopCatalogProject, DesktopCatalogStorageError> {
		try {
			const changed = this.database
				.prepare(
					`UPDATE projects
					 SET display_name = ?, path = ?, canonical_path = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.run(input.displayName, input.path, input.canonicalPath, input.updatedAt, input.id);
			if (changed.changes === 0) {
				return Result.err(
					new DesktopCatalogProjectNotFound({
						message: `Desktop project "${input.id}" does not exist`,
						projectId: input.id,
					}),
				);
			}
			return Result.ok(input);
		} catch (cause) {
			if (isUniqueViolation(cause)) {
				return Result.err(
					new DesktopCatalogProjectPathConflict({
						message: `Desktop project path "${input.canonicalPath}" is already cataloged`,
						canonicalPath: input.canonicalPath,
					}),
				);
			}
			return Result.err(this.failed(`Could not relink Desktop project "${input.id}"`, cause));
		}
	}

	getProject(projectId: string): ResultType<DesktopCatalogProject | undefined, DesktopCatalogStorageError> {
		try {
			const row = this.database
				.prepare(
					`SELECT id, display_name, path, canonical_path, created_at, updated_at
					 FROM projects WHERE id = ?`,
				)
				.get(projectId) as ProjectRow | undefined;
			return Result.ok(row ? projectRow(row) : undefined);
		} catch (cause) {
			return Result.err(this.failed(`Could not load Desktop project "${projectId}"`, cause));
		}
	}

	listSessions(
		input: { readonly limit?: number; readonly cursor?: DesktopCatalogSessionCursor } = {},
	): ResultType<DesktopCatalogSessionPage, DesktopCatalogStorageError> {
		try {
			const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
			const cursorTimestamp = input.cursor ? new Date(input.cursor.lastActivityAt).toISOString() : undefined;
			const rows = input.cursor
				? (this.database
						.prepare(
							`${sessionSelect()}
							 WHERE journal.updated_at < ?
							    OR (journal.updated_at = ? AND journal.id < ?)
							 ORDER BY journal.updated_at DESC, journal.id DESC
							 LIMIT ?`,
						)
						.all(cursorTimestamp!, cursorTimestamp!, input.cursor.id, limit + 1) as unknown as SessionRow[])
				: (this.database
						.prepare(`${sessionSelect()} ORDER BY journal.updated_at DESC, journal.id DESC LIMIT ?`)
						.all(limit + 1) as unknown as SessionRow[]);
			const sessions = rows.slice(0, limit).map(sessionRow);
			const last = sessions.at(-1);
			return Result.ok({
				sessions,
				...(rows.length > limit && last
					? { nextCursor: { lastActivityAt: last.lastActivityAt, id: last.id } }
					: {}),
			});
		} catch (cause) {
			return Result.err(this.failed("Could not list Desktop Sessions", cause));
		}
	}

	getSession(sessionId: string): ResultType<DesktopCatalogSession | undefined, DesktopCatalogStorageError> {
		try {
			const row = this.database.prepare(`${sessionSelect()} WHERE journal.id = ?`).get(sessionId) as
				| SessionRow
				| undefined;
			return Result.ok(row ? sessionRow(row) : undefined);
		} catch (cause) {
			return Result.err(this.failed(`Could not load Desktop Session "${sessionId}"`, cause));
		}
	}

	deleteSession(sessionId: string): ResultType<void, DesktopCatalogStorageError> {
		try {
			const deleted = this.database.prepare("DELETE FROM session_journals WHERE id = ?").run(sessionId);
			if (deleted.changes === 0) {
				return Result.err(
					new DesktopCatalogSessionNotFound({
						message: `Desktop Session "${sessionId}" does not exist`,
						sessionId,
					}),
				);
			}
			return Result.ok(undefined);
		} catch (cause) {
			return Result.err(this.failed(`Could not delete Desktop Session "${sessionId}"`, cause));
		}
	}

	ensureSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
		readonly title: string;
	}): ResultType<DesktopCatalogSession, DesktopCatalogStorageError> {
		try {
			return Result.ok(
				this.transaction(() => {
					this.requireSession(input.sessionId);
					if (input.projectId !== null) this.requireProject(input.projectId);
					this.database
						.prepare(
							`INSERT INTO desktop_session_metadata
							 (session_id, project_id, title, title_source, title_generation_attempted_at)
							 VALUES (?, ?, ?, 'fallback', NULL)
							 ON CONFLICT(session_id) DO NOTHING`,
						)
						.run(input.sessionId, input.projectId, input.title);
					return this.requireSession(input.sessionId);
				}),
			);
		} catch (cause) {
			return Result.err(this.projectError(input.sessionId, cause));
		}
	}

	renameSession(input: {
		readonly sessionId: string;
		readonly title: string;
	}): ResultType<DesktopCatalogSession, DesktopCatalogStorageError> {
		try {
			return Result.ok(
				this.transaction(() => {
					const session = this.requireSession(input.sessionId);
					this.database
						.prepare(
							`INSERT INTO desktop_session_metadata
							 (session_id, project_id, title, title_source, title_generation_attempted_at)
							 VALUES (?, ?, ?, 'manual', NULL)
							 ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, title_source = 'manual'`,
						)
						.run(input.sessionId, session.projectId, input.title);
					return this.requireSession(input.sessionId);
				}),
			);
		} catch (cause) {
			return Result.err(this.projectError(input.sessionId, cause));
		}
	}

	markTitleGenerationAttempted(input: {
		readonly sessionId: string;
		readonly timestamp: number;
	}): ResultType<DesktopCatalogSession, DesktopCatalogStorageError> {
		try {
			return Result.ok(
				this.transaction(() => {
					const session = this.requireSession(input.sessionId);
					this.database
						.prepare(
							`INSERT INTO desktop_session_metadata
							 (session_id, project_id, title, title_source, title_generation_attempted_at)
							 VALUES (?, ?, 'New session', 'fallback', ?)
							 ON CONFLICT(session_id) DO UPDATE SET
							 title_generation_attempted_at = COALESCE(
							   desktop_session_metadata.title_generation_attempted_at,
							   excluded.title_generation_attempted_at
							 )`,
						)
						.run(input.sessionId, session.projectId, input.timestamp);
					return this.requireSession(input.sessionId);
				}),
			);
		} catch (cause) {
			return Result.err(this.projectError(input.sessionId, cause));
		}
	}

	setGeneratedTitle(input: {
		readonly sessionId: string;
		readonly title: string;
	}): ResultType<DesktopCatalogSession, DesktopCatalogStorageError> {
		try {
			return Result.ok(
				this.transaction(() => {
					const session = this.requireSession(input.sessionId);
					this.database
						.prepare(
							`INSERT INTO desktop_session_metadata
							 (session_id, project_id, title, title_source, title_generation_attempted_at)
							 VALUES (?, ?, ?, 'generated', NULL)
							 ON CONFLICT(session_id) DO UPDATE SET
							 title = excluded.title,
							 title_source = 'generated'
							 WHERE desktop_session_metadata.title_source = 'fallback'`,
						)
						.run(input.sessionId, session.projectId, input.title);
					return this.requireSession(input.sessionId);
				}),
			);
		} catch (cause) {
			return Result.err(this.projectError(input.sessionId, cause));
		}
	}

	shouldGenerateSessionTitle(sessionId: string): ResultType<boolean, DesktopCatalogStorageError> {
		try {
			this.requireSession(sessionId);
			const metadata = this.database
				.prepare(
					`SELECT title_source, title_generation_attempted_at
					 FROM desktop_session_metadata WHERE session_id = ?`,
				)
				.get(sessionId) as
				| { readonly title_source: string; readonly title_generation_attempted_at: number | null }
				| undefined;
			return Result.ok(
				metadata === undefined ||
					(metadata.title_source === "fallback" && metadata.title_generation_attempted_at === null),
			);
		} catch (cause) {
			return Result.err(this.projectError(sessionId, cause));
		}
	}

	moveSession(input: {
		readonly sessionId: string;
		readonly projectId: string | null;
	}): ResultType<DesktopCatalogSession, DesktopCatalogStorageError> {
		try {
			return Result.ok(
				this.transaction(() => {
					const session = this.requireSession(input.sessionId);
					if (input.projectId !== null) this.requireProject(input.projectId);
					this.database
						.prepare(
							`INSERT INTO desktop_session_metadata
							 (session_id, project_id, title, title_source, title_generation_attempted_at)
							 VALUES (?, ?, ?, ?, NULL)
							 ON CONFLICT(session_id) DO UPDATE SET project_id = excluded.project_id`,
						)
						.run(input.sessionId, input.projectId, session.title, session.titleSource);
					return this.requireSession(input.sessionId);
				}),
			);
		} catch (cause) {
			return Result.err(this.projectError(input.sessionId, cause));
		}
	}

	private initialize(): void {
		this.database.exec("PRAGMA foreign_keys = ON");
		this.database.exec("PRAGMA busy_timeout = 5000");
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				display_name TEXT NOT NULL,
				path TEXT NOT NULL,
				canonical_path TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS desktop_session_metadata (
				session_id TEXT PRIMARY KEY REFERENCES session_journals(id) ON DELETE CASCADE,
				project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
				title TEXT NOT NULL,
				title_source TEXT NOT NULL CHECK (title_source IN ('fallback', 'generated', 'manual')),
				title_generation_attempted_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS desktop_session_metadata_project
				ON desktop_session_metadata(project_id);
		`);
	}

	private requireProject(projectId: string): DesktopCatalogProject {
		const found = this.getProject(projectId);
		if (found.isErr()) throw found.error;
		if (found.value) return found.value;
		throw new DesktopCatalogProjectNotFound({
			message: `Desktop project "${projectId}" does not exist`,
			projectId,
		});
	}

	private requireSession(sessionId: string): DesktopCatalogSession {
		const found = this.getSession(sessionId);
		if (found.isErr()) throw found.error;
		if (found.value) return found.value;
		throw new DesktopCatalogSessionNotFound({
			message: `Desktop Session "${sessionId}" does not exist`,
			sessionId,
		});
	}

	private transaction<T>(operation: () => T): T {
		this.database.exec("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.database.exec("COMMIT");
			return result;
		} catch (cause) {
			this.database.exec("ROLLBACK");
			throw cause;
		}
	}

	private failed(message: string, cause: unknown): DesktopCatalogStorageFailed {
		return new DesktopCatalogStorageFailed({ message, cause });
	}

	private projectError(sessionId: string, cause: unknown): DesktopCatalogStorageError {
		if (
			cause instanceof DesktopCatalogProjectNotFound ||
			cause instanceof DesktopCatalogSessionNotFound ||
			cause instanceof DesktopCatalogProjectPathConflict ||
			cause instanceof DesktopCatalogStorageCorrupted ||
			cause instanceof DesktopCatalogStorageFailed
		) {
			return cause;
		}
		return this.failed(`Could not update Desktop Session "${sessionId}"`, cause);
	}
}

function sessionSelect(): string {
	return `SELECT journal.id, metadata.project_id,
		COALESCE(metadata.title, 'New session') AS title,
		COALESCE(metadata.title_source, 'fallback') AS title_source,
		journal.updated_at,
		metadata.title_generation_attempted_at
		FROM session_journals AS journal
		LEFT JOIN desktop_session_metadata AS metadata ON metadata.session_id = journal.id`;
}

function projectRow(row: ProjectRow): DesktopCatalogProject {
	if (
		typeof row.id !== "string" ||
		typeof row.display_name !== "string" ||
		typeof row.path !== "string" ||
		typeof row.canonical_path !== "string" ||
		typeof row.created_at !== "number" ||
		typeof row.updated_at !== "number"
	) {
		throw new DesktopCatalogStorageCorrupted({ message: "Desktop project row is invalid" });
	}
	return {
		id: row.id,
		displayName: row.display_name,
		path: row.path,
		canonicalPath: row.canonical_path,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function sessionRow(row: SessionRow): DesktopCatalogSession {
	if (
		typeof row.id !== "string" ||
		(row.project_id !== null && typeof row.project_id !== "string") ||
		typeof row.title !== "string" ||
		!isTitleSource(row.title_source) ||
		typeof row.updated_at !== "string" ||
		(row.title_generation_attempted_at !== null && typeof row.title_generation_attempted_at !== "number")
	) {
		throw new DesktopCatalogStorageCorrupted({ message: "Desktop Session Catalog row is invalid" });
	}
	const lastActivityAt = Date.parse(row.updated_at);
	if (!Number.isFinite(lastActivityAt)) {
		throw new DesktopCatalogStorageCorrupted({ message: "Desktop Session Catalog timestamp is invalid" });
	}
	return {
		id: row.id,
		projectId: row.project_id,
		title: row.title,
		titleSource: row.title_source,
		lastActivityAt,
	};
}

function isTitleSource(value: string): value is DesktopCatalogTitleSource {
	return value === "fallback" || value === "generated" || value === "manual";
}

function isUniqueViolation(cause: unknown): boolean {
	return cause instanceof Error && /UNIQUE constraint failed/i.test(cause.message);
}
