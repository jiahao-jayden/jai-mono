import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	type JsonObject,
	replay,
	SessionBusyError,
	SessionConflictError,
	type SessionEntry,
	type SessionFollowListener,
	SessionFollowLost,
	SessionReadOnlyError,
	type SessionStore,
	type StoredSession,
} from "@jai/agent";
import { Result, TaggedError } from "better-result";

class CorruptedSqliteSession extends TaggedError("session.corrupted_sqlite")<{ readonly message: string }> {}

interface SessionRow {
	readonly id: string;
	readonly revision: string;
	readonly initial_app_state_json: string;
	readonly created_at: string;
}

interface EntryRow {
	readonly entry_type: string;
	readonly entry_json: string;
}

interface Follower<TAppState extends JsonObject> {
	reload(): void;
	lose(message: string): void;
}

/**
 * SQLite-backed implementation of the generic append-only session journal.
 *
 * Host-specific tables may live in the same database, but this adapter owns only the
 * SessionStore contract: header, revision, ordered entries and follow semantics.
 */
export class SqliteSessionStore<TAppState extends JsonObject = JsonObject> implements SessionStore<TAppState> {
	readonly #followers = new Map<string, Set<Follower<TAppState>>>();
	readonly #ownsDatabase: boolean;

	constructor(
		private readonly database: DatabaseSync,
		options: { readonly ownsDatabase?: boolean } = {},
	) {
		this.#ownsDatabase = options.ownsDatabase ?? false;
		this.initialize();
	}

	static async open<TAppState extends JsonObject = JsonObject>(databasePath: string): Promise<SqliteSessionStore<TAppState>> {
		await mkdir(dirname(databasePath), { recursive: true });
		return new SqliteSessionStore<TAppState>(new DatabaseSync(databasePath), { ownsDatabase: true });
	}

	async load(id: string): Promise<StoredSession<TAppState> | undefined> {
		const row = this.database
			.prepare(
				`SELECT id, revision, initial_app_state_json, created_at
				 FROM session_journals
				 WHERE id = ?`,
			)
			.get(id) as SessionRow | undefined;
		if (!row) return undefined;

		const initialAppState = parseJsonObject(row.initial_app_state_json, `Session "${id}" has invalid initial app state`);
		const { entries, readOnly } = this.entries(id);
		return {
			snapshot: replay(initialAppState as TAppState, entries, row.created_at),
			revision: row.revision,
			readOnly,
		};
	}

	async create(id: string, appState: TAppState): Promise<string> {
		const revision = crypto.randomUUID();
		const createdAt = new Date().toISOString();
		try {
			this.transaction(() => {
				const result = this.database
					.prepare(
						`INSERT INTO session_journals (id, revision, initial_app_state_json, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(id, revision, JSON.stringify(appState), createdAt, createdAt);
				if (result.changes !== 1) throw new SessionConflictError(`Session "${id}" already exists`);
			});
		} catch (error) {
			if (isUniqueViolation(error)) throw new SessionConflictError(`Session "${id}" already exists`, { cause: error });
			throw this.projectWriteError(id, error);
		}
		return revision;
	}

	async append(id: string, entry: SessionEntry<TAppState>, expectedRevision: string): Promise<string> {
		const revision = crypto.randomUUID();
		try {
			this.transaction(() => {
				const current = this.database.prepare("SELECT revision FROM session_journals WHERE id = ?").get(id) as
					| { readonly revision: string }
					| undefined;
				if (!current) throw new SessionConflictError(`Session "${id}" does not exist`);
				if (current.revision !== expectedRevision) throw new SessionConflictError(`Session "${id}" revision conflict`);
				if (this.hasUnknownEntries(id)) {
					throw new SessionReadOnlyError(`Session "${id}" contains entries written by a newer version`);
				}

				const nextSequence = this.database
					.prepare("SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM session_journal_entries WHERE session_id = ?")
					.get(id) as { readonly sequence: number };
				this.database
					.prepare(
						`INSERT INTO session_journal_entries (session_id, sequence, entry_id, entry_type, entry_json)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(id, nextSequence.sequence, entry.id, entry.type, JSON.stringify(entry));
				this.database
					.prepare("UPDATE session_journals SET revision = ?, updated_at = ? WHERE id = ?")
					.run(revision, entry.timestamp, id);
			});
		} catch (error) {
			throw this.projectWriteError(id, error);
		}
		this.notify(id);
		return revision;
	}

	async list(): Promise<string[]> {
		return (this.database.prepare("SELECT id FROM session_journals ORDER BY id ASC").all() as { readonly id: string }[]).map(
			(row) => row.id,
		);
	}

	async delete(id: string): Promise<void> {
		try {
			this.transaction(() => {
				this.database.prepare("DELETE FROM session_journals WHERE id = ?").run(id);
			});
		} catch (error) {
			throw this.projectWriteError(id, error);
		}
		const followers = this.#followers.get(id);
		if (!followers) return;
		this.#followers.delete(id);
		for (const follower of followers) follower.lose(`Session "${id}" was deleted`);
	}

	follow(id: string, afterEntryId: string | undefined, listener: SessionFollowListener<TAppState>): () => void {
		let closed = false;
		let cursorId = afterEntryId;
		let tail = Promise.resolve();
		const poller = setInterval(reload, 250);

		const stop = (): void => {
			if (closed) return;
			closed = true;
			clearInterval(poller);
			const followers = this.#followers.get(id);
			followers?.delete(follower);
			if (followers?.size === 0) this.#followers.delete(id);
		};
		const lose = (message: string): void => {
			if (closed) return;
			listener(Result.err(new SessionFollowLost({ message, afterEntryId: cursorId ?? "" })));
			stop();
		};
		const read = async (): Promise<void> => {
			if (closed) return;
			const record = await this.load(id);
			if (closed) return;
			if (!record) return lose(`Session "${id}" does not exist`);
			let start = 0;
			if (cursorId !== undefined) {
				const index = record.snapshot.entries.findIndex((entry) => entry.id === cursorId);
				if (index < 0) return lose(`Entry "${cursorId}" was not found`);
				start = index + 1;
			}
			const entries = record.snapshot.entries.slice(start);
			if (entries.length === 0) return;
			cursorId = entries.at(-1)!.id;
			listener(Result.ok({ entries, revision: record.revision, lastEntryId: cursorId }));
		};
		function reload(): void {
			tail = tail.then(async () => {
				try {
					await read();
				} catch (error) {
					lose(error instanceof Error ? error.message : `Session "${id}" could not be read`);
				}
			});
		}
		const follower: Follower<TAppState> = { reload, lose };
		const followers = this.#followers.get(id) ?? new Set<Follower<TAppState>>();
		followers.add(follower);
		this.#followers.set(id, followers);
		reload();
		return stop;
	}

	close(): void {
		for (const followers of this.#followers.values()) {
			for (const follower of followers) follower.lose("Session store was closed");
		}
		this.#followers.clear();
		if (this.#ownsDatabase) this.database.close();
	}

	private initialize(): void {
		this.database.exec("PRAGMA foreign_keys = ON");
		this.database.exec("PRAGMA busy_timeout = 5000");
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS session_journals (
				id TEXT PRIMARY KEY,
				revision TEXT NOT NULL,
				initial_app_state_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS session_journal_entries (
				session_id TEXT NOT NULL REFERENCES session_journals(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL,
				entry_id TEXT NOT NULL UNIQUE,
				entry_type TEXT NOT NULL,
				entry_json TEXT NOT NULL,
				PRIMARY KEY (session_id, sequence)
			);
			CREATE INDEX IF NOT EXISTS session_journal_entries_session_id ON session_journal_entries(session_id, sequence);
		`);
	}

	private entries(id: string): { entries: SessionEntry<TAppState>[]; readOnly: boolean } {
		const rows = this.database
			.prepare(
				`SELECT entry_type, entry_json
				 FROM session_journal_entries
				 WHERE session_id = ?
				 ORDER BY sequence ASC`,
			)
			.all(id) as unknown as EntryRow[];
		const entries: SessionEntry<TAppState>[] = [];
		let readOnly = false;
		for (const row of rows) {
			if (!isKnownEntryType(row.entry_type)) {
				readOnly = true;
				continue;
			}
			try {
				const entry = JSON.parse(row.entry_json) as SessionEntry<TAppState>;
				if (entry.type !== row.entry_type) {
					readOnly = true;
					continue;
				}
				entries.push(entry);
			} catch {
				throw new CorruptedSqliteSession({ message: `Session "${id}" contains malformed entry JSON` });
			}
		}
		return { entries, readOnly };
	}

	private hasUnknownEntries(id: string): boolean {
		const rows = this.database
			.prepare("SELECT entry_type FROM session_journal_entries WHERE session_id = ?")
			.all(id) as { readonly entry_type: string }[];
		return rows.some((row) => !isKnownEntryType(row.entry_type));
	}

	private notify(id: string): void {
		for (const follower of this.#followers.get(id) ?? []) follower.reload();
	}

	private transaction<T>(operation: () => T): T {
		this.database.exec("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.database.exec("COMMIT");
			return result;
		} catch (error) {
			this.database.exec("ROLLBACK");
			throw error;
		}
	}

	private projectWriteError(id: string, error: unknown): unknown {
		if (
			error instanceof SessionConflictError ||
			error instanceof SessionReadOnlyError ||
			error instanceof SessionBusyError
		) {
			return error;
		}
		if (isBusy(error)) return new SessionBusyError(`Session "${id}" is busy`, { cause: error });
		return error;
	}
}

function parseJsonObject(raw: string, message: string): JsonObject {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new CorruptedSqliteSession({ message });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new CorruptedSqliteSession({ message });
	}
	return value as JsonObject;
}

function isKnownEntryType(type: string): type is SessionEntry["type"] {
	return type === "message" || type === "app_state" || type === "compaction" || type === "branch";
}

function isUniqueViolation(error: unknown): boolean {
	return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

function isBusy(error: unknown): boolean {
	return error instanceof Error && /database is locked|database is busy/i.test(error.message);
}
