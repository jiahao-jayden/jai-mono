import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	databaseInvalidError,
	databaseUnsupportedError,
	sessionNotFoundError,
	workspaceNotFoundError,
	workspacePathConflictError,
} from "./errors";
import type { CodingBusinessRepository, CreateSessionRecord, CreateWorkspaceRecord } from "./repository";
import type {
	CodingSession,
	ProviderModelInventory,
	SessionListCursor,
	SessionListPage,
	SessionWorkspaceHistory,
	Workspace,
} from "./types";

const SCHEMA_VERSION = 2;

export class SqliteCodingBusinessRepository implements CodingBusinessRepository {
	readonly #database: DatabaseSync;

	private constructor(database: DatabaseSync) {
		this.#database = database;
		this.#migrate();
	}

	static async open(path: string): Promise<SqliteCodingBusinessRepository> {
		if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
		return new SqliteCodingBusinessRepository(new DatabaseSync(path));
	}

	createWorkspace(record: CreateWorkspaceRecord): Workspace {
		try {
			this.#database
				.prepare(
					`INSERT INTO workspaces
						(id, display_name, path, canonical_path, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.run(record.id, record.displayName, record.path, record.canonicalPath, record.now, record.now);
		} catch (error) {
			if (this.findWorkspaceByCanonicalPath(record.canonicalPath)) {
				throw workspacePathConflictError(record.canonicalPath, error);
			}
			throw error;
		}
		return this.#requireWorkspace(record.id);
	}

	getWorkspace(id: string): Workspace | undefined {
		return mapWorkspace(
			this.#database
				.prepare(
					`SELECT id, display_name, path, canonical_path, created_at, updated_at
					 FROM workspaces WHERE id = ?`,
				)
				.get(id),
		);
	}

	findWorkspaceByCanonicalPath(canonicalPath: string): Workspace | undefined {
		return mapWorkspace(
			this.#database
				.prepare(
					`SELECT id, display_name, path, canonical_path, created_at, updated_at
					 FROM workspaces WHERE canonical_path = ?`,
				)
				.get(canonicalPath),
		);
	}

	listWorkspaces(): Workspace[] {
		return this.#database
			.prepare(
				`SELECT id, display_name, path, canonical_path, created_at, updated_at
				 FROM workspaces ORDER BY created_at ASC, id ASC`,
			)
			.all()
			.map((row) => mapWorkspace(row)!);
	}

	relinkWorkspace(
		id: string,
		location: {
			readonly displayName: string;
			readonly path: string;
			readonly canonicalPath: string;
			readonly now: number;
		},
	): Workspace {
		try {
			const result = this.#database
				.prepare(
					`UPDATE workspaces
					 SET display_name = ?, path = ?, canonical_path = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.run(location.displayName, location.path, location.canonicalPath, location.now, id);
			if (result.changes === 0) throw workspaceNotFoundError(id);
		} catch (error) {
			const conflict = this.findWorkspaceByCanonicalPath(location.canonicalPath);
			if (conflict && conflict.id !== id) throw workspacePathConflictError(location.canonicalPath, error);
			throw error;
		}
		return this.#requireWorkspace(id);
	}

	createSession(record: CreateSessionRecord): CodingSession {
		this.#database
			.prepare(
				`INSERT INTO sessions
					(id, workspace_id, title, title_source, title_generation_attempted_at,
					 created_at, updated_at, last_activity_at)
				 VALUES (?, ?, ?, 'fallback', NULL, ?, ?, ?)`,
			)
			.run(record.id, record.workspaceId, record.title, record.now, record.now, record.now);
		return this.#requireSession(record.id);
	}

	deleteSession(id: string): void {
		this.#database.prepare("DELETE FROM sessions WHERE id = ?").run(id);
	}

	getSession(id: string): CodingSession | undefined {
		return mapSession(this.#sessionStatement().get(id));
	}

	listSessions(input: { readonly limit?: number; readonly cursor?: SessionListCursor } = {}): SessionListPage {
		const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
		const rows = input.cursor
			? this.#database
					.prepare(
						`${sessionSelect()}
						 WHERE last_activity_at < ?
						    OR (last_activity_at = ? AND id < ?)
						 ORDER BY last_activity_at DESC, id DESC
						 LIMIT ?`,
					)
					.all(input.cursor.lastActivityAt, input.cursor.lastActivityAt, input.cursor.id, limit + 1)
			: this.#database.prepare(`${sessionSelect()} ORDER BY last_activity_at DESC, id DESC LIMIT ?`).all(limit + 1);
		const sessions = rows.slice(0, limit).map((row) => mapSession(row)!);
		const last = sessions.at(-1);
		return {
			sessions,
			...(rows.length > limit && last ? { nextCursor: { lastActivityAt: last.lastActivityAt, id: last.id } } : {}),
		};
	}

	renameSession(id: string, title: string, now: number): CodingSession {
		this.#updateSession(
			id,
			"UPDATE sessions SET title = ?, title_source = 'manual', updated_at = ? WHERE id = ?",
			title,
			now,
		);
		return this.#requireSession(id);
	}

	markTitleGenerationAttempted(id: string, now: number): CodingSession {
		this.#updateSession(
			id,
			`UPDATE sessions
			 SET title_generation_attempted_at = COALESCE(title_generation_attempted_at, ?),
			     updated_at = ?
			 WHERE id = ?`,
			now,
			now,
		);
		return this.#requireSession(id);
	}

	setGeneratedTitle(id: string, title: string, now: number): CodingSession {
		const session = this.#requireSession(id);
		if (session.titleSource !== "fallback") return session;
		this.#database
			.prepare(
				`UPDATE sessions
				 SET title = ?, title_source = 'generated', updated_at = ?
				 WHERE id = ? AND title_source = 'fallback'`,
			)
			.run(title, now, id);
		return this.#requireSession(id);
	}

	touchSession(id: string, now: number): CodingSession {
		this.#updateSession(id, "UPDATE sessions SET updated_at = ?, last_activity_at = ? WHERE id = ?", now, now);
		return this.#requireSession(id);
	}

	moveSession(id: string, toWorkspaceId: string | null, now: number): CodingSession {
		const current = this.#requireSession(id);
		if (toWorkspaceId !== null) this.#requireWorkspace(toWorkspaceId);
		if (current.workspaceId === toWorkspaceId) return current;

		this.#transaction(() => {
			this.#database
				.prepare("UPDATE sessions SET workspace_id = ?, updated_at = ? WHERE id = ?")
				.run(toWorkspaceId, now, id);
			this.#database
				.prepare(
					`INSERT INTO session_workspace_history
						(session_id, from_workspace_id, to_workspace_id, moved_at)
					 VALUES (?, ?, ?, ?)`,
				)
				.run(id, current.workspaceId, toWorkspaceId, now);
		});
		return this.#requireSession(id);
	}

	listWorkspaceHistory(sessionId: string): SessionWorkspaceHistory[] {
		this.#requireSession(sessionId);
		return this.#database
			.prepare(
				`SELECT id, session_id, from_workspace_id, to_workspace_id, moved_at
				 FROM session_workspace_history
				 WHERE session_id = ?
				 ORDER BY id ASC`,
			)
			.all(sessionId)
			.map((row) => mapWorkspaceHistory(row));
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
		this.#database
			.prepare("UPDATE provider_model_inventory SET profile_id = ? WHERE profile_id = ?")
			.run(toProfileId, fromProfileId);
	}

	close(): void {
		this.#database.close();
	}

	#migrate(): void {
		this.#database.exec("PRAGMA foreign_keys = ON");
		this.#database.exec("PRAGMA journal_mode = WAL");
		this.#database.exec("PRAGMA synchronous = NORMAL");
		this.#database.exec("PRAGMA busy_timeout = 5000");
		const current = this.#database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
		const version = current?.user_version ?? 0;
		if (version > SCHEMA_VERSION) {
			throw databaseUnsupportedError(version);
		}
		if (version === SCHEMA_VERSION) return;

		this.#transaction(() => {
			if (version === 0) {
				this.#database.exec(`
				CREATE TABLE workspaces (
					id TEXT PRIMARY KEY,
					display_name TEXT NOT NULL,
					path TEXT NOT NULL,
					canonical_path TEXT NOT NULL UNIQUE,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);

				CREATE TABLE sessions (
					id TEXT PRIMARY KEY,
					workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
					title TEXT NOT NULL,
					title_source TEXT NOT NULL
						CHECK (title_source IN ('fallback', 'generated', 'manual')),
					title_generation_attempted_at INTEGER,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					last_activity_at INTEGER NOT NULL
				);

				CREATE TABLE session_workspace_history (
					id INTEGER PRIMARY KEY,
					session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
					from_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
					to_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
					moved_at INTEGER NOT NULL
				);

				CREATE INDEX sessions_recents
					ON sessions(last_activity_at DESC, id DESC);
				CREATE INDEX sessions_workspace
					ON sessions(workspace_id, last_activity_at DESC, id DESC);
				CREATE TABLE provider_model_inventory (
					profile_id TEXT PRIMARY KEY,
					model_ids_json TEXT NOT NULL,
					fetched_at INTEGER NOT NULL
				);
				PRAGMA user_version = ${SCHEMA_VERSION};
			`);
				return;
			}
			if (version === 1) {
				this.#database.exec(`
					CREATE TABLE provider_model_inventory (
						profile_id TEXT PRIMARY KEY,
						model_ids_json TEXT NOT NULL,
						fetched_at INTEGER NOT NULL
					);
					PRAGMA user_version = ${SCHEMA_VERSION};
				`);
			}
		});
	}

	#sessionStatement() {
		return this.#database.prepare(`${sessionSelect()} WHERE id = ?`);
	}

	#requireWorkspace(id: string): Workspace {
		const workspace = this.getWorkspace(id);
		if (!workspace) throw workspaceNotFoundError(id);
		return workspace;
	}

	#requireSession(id: string): CodingSession {
		const session = this.getSession(id);
		if (!session) throw sessionNotFoundError(id);
		return session;
	}

	#updateSession(id: string, sql: string, ...parameters: (string | number | null)[]): void {
		const result = this.#database.prepare(sql).run(...parameters, id);
		if (result.changes === 0) throw sessionNotFoundError(id);
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

function sessionSelect(): string {
	return `SELECT id, workspace_id, title, title_source, title_generation_attempted_at,
		created_at, updated_at, last_activity_at
		FROM sessions`;
}

function mapWorkspace(value: unknown): Workspace | undefined {
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
	const workspaceId = value.workspace_id;
	const titleGenerationAttemptedAt = value.title_generation_attempted_at;
	return {
		id: stringColumn(value, "id"),
		workspaceId: workspaceId === null ? null : stringColumn(value, "workspace_id"),
		title: stringColumn(value, "title"),
		titleSource: stringColumn(value, "title_source") as CodingSession["titleSource"],
		titleGenerationAttemptedAt:
			titleGenerationAttemptedAt === null ? null : numberColumn(value, "title_generation_attempted_at"),
		createdAt: numberColumn(value, "created_at"),
		updatedAt: numberColumn(value, "updated_at"),
		lastActivityAt: numberColumn(value, "last_activity_at"),
	};
}

function mapWorkspaceHistory(value: unknown): SessionWorkspaceHistory {
	if (!isRow(value)) throw databaseInvalidError("Invalid session workspace history row");
	return {
		id: numberColumn(value, "id"),
		sessionId: stringColumn(value, "session_id"),
		fromWorkspaceId: nullableStringColumn(value, "from_workspace_id"),
		toWorkspaceId: nullableStringColumn(value, "to_workspace_id"),
		movedAt: numberColumn(value, "moved_at"),
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
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
		left.localeCompare(right),
	);
}

function isRow(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringColumn(row: Record<string, unknown>, name: string): string {
	const value = row[name];
	if (typeof value !== "string") throw databaseInvalidError(`Invalid SQLite string column "${name}"`);
	return value;
}

function nullableStringColumn(row: Record<string, unknown>, name: string): string | null {
	return row[name] === null ? null : stringColumn(row, name);
}

function numberColumn(row: Record<string, unknown>, name: string): number {
	const value = row[name];
	if (typeof value !== "number") throw databaseInvalidError(`Invalid SQLite number column "${name}"`);
	return value;
}
