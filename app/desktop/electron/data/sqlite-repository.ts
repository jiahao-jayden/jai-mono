import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { type JsonObject } from "@jai/agent";
import { SqliteSessionStore } from "@jai/agent/node";
import { DatabaseSync } from "node:sqlite";
import { databaseInvalidError, projectNotFoundError, projectPathConflictError, sessionNotFoundError } from "./errors";
import type { CodingBusinessRepository, CreateProjectRecord, CreateSessionRecord } from "./repository";
import type { CodingSession, Project, ProviderModelInventory, SessionListCursor, SessionListPage } from "./types";

const SCHEMA_VERSION = 6;

/**
 * Desktop metadata in the same SQLite database as the generic SessionStore journal.
 * The journal owns messages and app state; this module owns only Desktop concepts.
 */
export class SqliteCodingBusinessRepository implements CodingBusinessRepository {
	readonly #database: DatabaseSync;
	readonly #sessionStore: SqliteSessionStore<JsonObject>;

	private constructor(database: DatabaseSync) {
		this.#database = database;
		// The generic journal schema has to exist before Desktop metadata adds its
		// foreign key. This does not merge the responsibilities: the store still
		// owns only journal rows, and this repository owns only Desktop metadata.
		this.#sessionStore = new SqliteSessionStore<JsonObject>(database);
		this.#migrate();
	}

	static async open(databasePath: string): Promise<SqliteCodingBusinessRepository> {
		if (databasePath !== ":memory:") await mkdir(dirname(databasePath), { recursive: true });
		const database = new DatabaseSync(databasePath);
		const version = userVersion(database);
		if (version === 0 || version === SCHEMA_VERSION) return new SqliteCodingBusinessRepository(database);
		database.close();
		await Promise.all([databasePath, `${databasePath}-shm`, `${databasePath}-wal`].map((file) => rm(file, { force: true })));
		return new SqliteCodingBusinessRepository(new DatabaseSync(databasePath));
	}

	createSessionStore<TAppState extends JsonObject = JsonObject>(): SqliteSessionStore<TAppState> {
		return this.#sessionStore as SqliteSessionStore<TAppState>;
	}

	createProject(record: CreateProjectRecord): Project {
		try {
			this.#database
				.prepare(
					`INSERT INTO projects (id, display_name, path, canonical_path, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.run(record.id, record.displayName, record.path, record.canonicalPath, record.now, record.now);
		} catch (error) {
			if (this.findProjectByCanonicalPath(record.canonicalPath)) throw projectPathConflictError(record.canonicalPath, error);
			throw error;
		}
		return this.#requireProject(record.id);
	}

	getProject(id: string): Project | undefined {
		return mapProject(
			this.#database
				.prepare(
					`SELECT id, display_name, path, canonical_path, created_at, updated_at
					 FROM projects WHERE id = ?`,
				)
				.get(id),
		);
	}

	findProjectByCanonicalPath(canonicalPath: string): Project | undefined {
		return mapProject(
			this.#database
				.prepare(
					`SELECT id, display_name, path, canonical_path, created_at, updated_at
					 FROM projects WHERE canonical_path = ?`,
				)
				.get(canonicalPath),
		);
	}

	listProjects(): Project[] {
		return this.#database
			.prepare(
				`SELECT id, display_name, path, canonical_path, created_at, updated_at
				 FROM projects ORDER BY created_at ASC, id ASC`,
			)
			.all()
			.map((row) => mapProject(row)!);
	}

	relinkProject(
		id: string,
		location: { readonly displayName: string; readonly path: string; readonly canonicalPath: string; readonly now: number },
	): Project {
		try {
			const result = this.#database
				.prepare(
					`UPDATE projects
					 SET display_name = ?, path = ?, canonical_path = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.run(location.displayName, location.path, location.canonicalPath, location.now, id);
			if (result.changes === 0) throw projectNotFoundError(id);
		} catch (error) {
			const conflict = this.findProjectByCanonicalPath(location.canonicalPath);
			if (conflict && conflict.id !== id) throw projectPathConflictError(location.canonicalPath, error);
			throw error;
		}
		return this.#requireProject(id);
	}

	createSession(record: CreateSessionRecord): CodingSession {
		this.#database
			.prepare(
				`INSERT INTO desktop_session_metadata (session_id, project_id, title, title_source, title_generation_attempted_at)
				 VALUES (?, ?, ?, 'fallback', NULL)`,
			)
			.run(record.id, record.projectId, record.title);
		return this.#requireSession(record.id);
	}

	getSession(id: string): CodingSession | undefined {
		return mapSession(this.#database.prepare(`${sessionSelect()} WHERE journal.id = ?`).get(id));
	}

	listSessions(input: { readonly limit?: number; readonly cursor?: SessionListCursor } = {}): SessionListPage {
		const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
		const cursorTimestamp = input.cursor ? new Date(input.cursor.lastActivityAt).toISOString() : undefined;
		const rows = input.cursor
			? this.#database
					.prepare(
						`${sessionSelect()}
						 WHERE journal.updated_at < ?
						    OR (journal.updated_at = ? AND journal.id < ?)
						 ORDER BY journal.updated_at DESC, journal.id DESC
						 LIMIT ?`,
					)
					.all(cursorTimestamp!, cursorTimestamp!, input.cursor.id, limit + 1)
			: this.#database.prepare(`${sessionSelect()} ORDER BY journal.updated_at DESC, journal.id DESC LIMIT ?`).all(limit + 1);
		const sessions = rows.slice(0, limit).map((row) => mapSession(row)!);
		const last = sessions.at(-1);
		return {
			sessions,
			...(rows.length > limit && last ? { nextCursor: { lastActivityAt: last.lastActivityAt, id: last.id } } : {}),
		};
	}

	renameSession(id: string, title: string): CodingSession {
		this.#requireSession(id);
		this.#database
			.prepare(
				`INSERT INTO desktop_session_metadata (session_id, project_id, title, title_source, title_generation_attempted_at)
				 VALUES (?, NULL, ?, 'manual', NULL)
				 ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, title_source = 'manual'`,
			)
			.run(id, title);
		return this.#requireSession(id);
	}

	markTitleGenerationAttempted(id: string, timestamp: number): CodingSession {
		this.#requireSession(id);
		this.#database
			.prepare(
				`INSERT INTO desktop_session_metadata (session_id, project_id, title, title_source, title_generation_attempted_at)
				 VALUES (?, NULL, 'New session', 'fallback', ?)
				 ON CONFLICT(session_id) DO UPDATE SET
				  title_generation_attempted_at = COALESCE(desktop_session_metadata.title_generation_attempted_at, excluded.title_generation_attempted_at)`,
			)
			.run(id, timestamp);
		return this.#requireSession(id);
	}

	setGeneratedTitle(id: string, title: string): CodingSession {
		this.#requireSession(id);
		this.#database
			.prepare(
				`INSERT INTO desktop_session_metadata (session_id, project_id, title, title_source, title_generation_attempted_at)
				 VALUES (?, NULL, ?, 'generated', NULL)
				 ON CONFLICT(session_id) DO UPDATE SET
				  title = excluded.title,
				  title_source = 'generated'
				 WHERE desktop_session_metadata.title_source = 'fallback'`,
			)
			.run(id, title);
		return this.#requireSession(id);
	}

	shouldGenerateSessionTitle(id: string): boolean {
		this.#requireSession(id);
		const metadata = this.#database
			.prepare(
				`SELECT title_source, title_generation_attempted_at
				 FROM desktop_session_metadata
				 WHERE session_id = ?`,
			)
			.get(id) as { readonly title_source: string; readonly title_generation_attempted_at: number | null } | undefined;
		return metadata === undefined || (metadata.title_source === "fallback" && metadata.title_generation_attempted_at === null);
	}

	moveSession(id: string, toProjectId: string | null): CodingSession {
		this.#requireSession(id);
		if (toProjectId !== null) this.#requireProject(toProjectId);
		this.#database
			.prepare(
				`INSERT INTO desktop_session_metadata (session_id, project_id, title, title_source, title_generation_attempted_at)
				 VALUES (?, ?, 'New session', 'fallback', NULL)
				 ON CONFLICT(session_id) DO UPDATE SET project_id = excluded.project_id`,
			)
			.run(id, toProjectId);
		return this.#requireSession(id);
	}

	getProviderModelInventory(profileId: string): ProviderModelInventory | undefined {
		return mapProviderModelInventory(
			this.#database
				.prepare(
					`SELECT profile_id, model_ids_json, fetched_at
					 FROM provider_model_inventory
					 WHERE profile_id = ?`,
				)
				.get(profileId),
		);
	}

	replaceProviderModelInventory(record: ProviderModelInventory): ProviderModelInventory {
		const modelIds = uniqueModelIds(record.modelIds);
		this.#database
			.prepare(
				`INSERT INTO provider_model_inventory (profile_id, model_ids_json, fetched_at)
				 VALUES (?, ?, ?)
				 ON CONFLICT(profile_id) DO UPDATE SET
				  model_ids_json = excluded.model_ids_json,
				  fetched_at = excluded.fetched_at`,
			)
			.run(record.profileId, JSON.stringify(modelIds), record.fetchedAt);
		return this.getProviderModelInventory(record.profileId)!;
	}

	deleteProviderModelInventory(profileId: string): void {
		this.#database.prepare("DELETE FROM provider_model_inventory WHERE profile_id = ?").run(profileId);
	}

	renameProviderModelInventory(fromProfileId: string, toProfileId: string): void {
		if (fromProfileId === toProfileId) return;
		this.#database.prepare("UPDATE provider_model_inventory SET profile_id = ? WHERE profile_id = ?").run(toProfileId, fromProfileId);
	}

	close(): void {
		this.#database.close();
	}

	#migrate(): void {
		this.#database.exec("PRAGMA foreign_keys = ON");
		this.#database.exec("PRAGMA journal_mode = WAL");
		this.#database.exec("PRAGMA synchronous = NORMAL");
		this.#database.exec("PRAGMA busy_timeout = 5000");
		if (userVersion(this.#database) === SCHEMA_VERSION) return;
		this.#transaction(() => {
			this.#database.exec(`
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
				CREATE TABLE IF NOT EXISTS provider_model_inventory (
					profile_id TEXT PRIMARY KEY,
					model_ids_json TEXT NOT NULL,
					fetched_at INTEGER NOT NULL
				);
				PRAGMA user_version = ${SCHEMA_VERSION};
			`);
		});
	}

	#requireProject(id: string): Project {
		const project = this.getProject(id);
		if (!project) throw projectNotFoundError(id);
		return project;
	}

	#requireSession(id: string): CodingSession {
		const session = this.getSession(id);
		if (!session) throw sessionNotFoundError(id);
		return session;
	}

	#transaction<T>(operation: () => T): T {
		this.#database.exec("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.#database.exec("COMMIT");
			return result;
		} catch (error) {
			this.#database.exec("ROLLBACK");
			throw error;
		}
	}
}

function userVersion(database: DatabaseSync): number {
	const result = database.prepare("PRAGMA user_version").get() as { readonly user_version?: number } | undefined;
	return result?.user_version ?? 0;
}

function sessionSelect(): string {
	return `SELECT journal.id, metadata.project_id,
		COALESCE(metadata.title, 'New session') AS title,
		COALESCE(metadata.title_source, 'fallback') AS title_source,
		journal.updated_at
		FROM session_journals AS journal
		LEFT JOIN desktop_session_metadata AS metadata ON metadata.session_id = journal.id`;
}

function mapProject(value: unknown): Project | undefined {
	if (!isRow(value)) return undefined;
	return {
		id: stringColumn(value, "id"),
		displayName: stringColumn(value, "display_name"),
		path: stringColumn(value, "path"),
		canonicalPath: stringColumn(value, "canonical_path"),
		createdAt: numberColumn(value, "created_at"),
		updatedAt: numberColumn(value, "updated_at"),
	};
}

function mapSession(value: unknown): CodingSession | undefined {
	if (!isRow(value)) return undefined;
	const projectId = value.project_id;
	const lastActivityAt = Date.parse(stringColumn(value, "updated_at"));
	if (!Number.isFinite(lastActivityAt)) throw databaseInvalidError("Invalid Session journal timestamp");
	return {
		id: stringColumn(value, "id"),
		projectId: projectId === null ? null : stringColumn(value, "project_id"),
		title: stringColumn(value, "title"),
		titleSource: stringColumn(value, "title_source") as CodingSession["titleSource"],
		lastActivityAt,
	};
}

function mapProviderModelInventory(value: unknown): ProviderModelInventory | undefined {
	if (value === undefined) return undefined;
	if (!isRow(value)) throw databaseInvalidError("Invalid provider model inventory row");
	const rawModelIds = stringColumn(value, "model_ids_json");
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawModelIds);
	} catch {
		throw databaseInvalidError("Invalid provider model inventory JSON");
	}
	if (!Array.isArray(parsed) || parsed.some((modelId) => typeof modelId !== "string")) {
		throw databaseInvalidError("Invalid provider model inventory model IDs");
	}
	return {
		profileId: stringColumn(value, "profile_id"),
		modelIds: uniqueModelIds(parsed),
		fetchedAt: numberColumn(value, "fetched_at"),
	};
}

function uniqueModelIds(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isRow(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringColumn(row: Record<string, unknown>, name: string): string {
	const value = row[name];
	if (typeof value !== "string") throw databaseInvalidError(`Invalid SQLite string column "${name}"`);
	return value;
}

function numberColumn(row: Record<string, unknown>, name: string): number {
	const value = row[name];
	if (typeof value !== "number") throw databaseInvalidError(`Invalid SQLite number column "${name}"`);
	return value;
}
