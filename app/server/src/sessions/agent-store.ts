import type { JsonObject, SessionEntry, SessionStore, StoredSession } from "@jai/agent";
import { TaggedError } from "better-result";
import type { ProductSessionPersistence } from "./types";

class RuntimeSessionStoreWriteFailed extends TaggedError("runtime_session_store.write_failed")<{
	readonly sessionId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

class RuntimeSessionStoreDeleteUnsupported extends TaggedError("runtime_session_store.delete_unsupported")<{
	readonly sessionId: string;
	readonly message: string;
}> {}

/** An in-process observation hook fired only after a Session entry is durable. */
export type RuntimeSessionEntryCommitted<TAppState extends JsonObject = JsonObject> = (
	sessionId: string,
	entry: SessionEntry<TAppState>,
) => void;

/**
 * Server-only adapter from the generic Agent SessionStore contract to Product
 * Session Persistence. It owns no durable facts: every mutation remains a
 * ProductSessionPersistence transaction in the Runtime Host's SQLite database.
 */
export class RuntimeSessionStore<TAppState extends JsonObject = JsonObject> implements SessionStore<TAppState> {
	constructor(
		private readonly persistence: ProductSessionPersistence<TAppState>,
		private readonly onEntryCommitted?: RuntimeSessionEntryCommitted<TAppState>,
	) {}

	async load(id: string): Promise<StoredSession<TAppState> | undefined> {
		const loaded = await this.persistence.load(id);
		if (loaded.isErr()) {
			if (loaded.error._tag === "product_sessions.not_found") return undefined;
			throw new RuntimeSessionStoreWriteFailed({
				message: `Could not load Session "${id}" through the Runtime Host store adapter`,
				sessionId: id,
				cause: loaded.error,
			});
		}
		return { snapshot: loaded.value.snapshot, revision: loaded.value.revision, readOnly: false };
	}

	async create(id: string, _appState: TAppState): Promise<string> {
		throw new RuntimeSessionStoreWriteFailed({
			message: `Session "${id}" must be created through RuntimeHost so its durable runtime configuration is established`,
			sessionId: id,
		});
	}

	async append(id: string, entry: SessionEntry<TAppState>, expectedRevision: string): Promise<string> {
		const appended = await this.persistence.appendEntry({ sessionId: id, entry, expectedRevision });
		if (appended.isOk()) {
			try {
				this.onEntryCommitted?.(id, entry);
			} catch {
				// Projection observers never invalidate a durable append.
			}
			return appended.value;
		}
		throw new RuntimeSessionStoreWriteFailed({
			message: `Could not append an entry to Session "${id}" through the Runtime Host store adapter`,
			sessionId: id,
			cause: appended.error,
		});
	}

	async delete(id: string): Promise<void> {
		throw new RuntimeSessionStoreDeleteUnsupported({
			message: `Runtime Host does not support deleting durable Session "${id}"`,
			sessionId: id,
		});
	}
}

/**
 * SessionStore backed by journal-only Product persistence: writes Session
 * journals without catalog entries, so child sessions never appear in the
 * product session list. Used by subagent child Agents.
 */
export class JournalOnlySessionStore<TAppState extends JsonObject = JsonObject> implements SessionStore<TAppState> {
	constructor(
		private readonly persistence: ProductSessionPersistence<TAppState>,
		private readonly onEntryCommitted?: RuntimeSessionEntryCommitted<TAppState>,
		private readonly now: () => Date = () => new Date(),
	) {}

	async load(id: string): Promise<StoredSession<TAppState> | undefined> {
		const loaded = await this.persistence.loadJournalOnly(id);
		if (loaded.isErr()) {
			if (loaded.error._tag === "product_sessions.not_found") return undefined;
			throw new RuntimeSessionStoreWriteFailed({
				message: `Could not load journal-only Session "${id}"`,
				sessionId: id,
				cause: loaded.error,
			});
		}
		return loaded.value;
	}

	async create(id: string, appState: TAppState): Promise<string> {
		const created = await this.persistence.createJournalOnly({
			id,
			appState,
			createdAt: this.now().toISOString(),
		});
		if (created.isOk()) return created.value;
		if (created.error._tag === "product_sessions.already_exists") {
			const loaded = await this.persistence.loadJournalOnly(id);
			if (loaded.isOk()) return loaded.value.revision;
		}
		throw new RuntimeSessionStoreWriteFailed({
			message: `Could not create journal-only Session "${id}"`,
			sessionId: id,
			cause: created.error,
		});
	}

	async append(id: string, entry: SessionEntry<TAppState>, expectedRevision: string): Promise<string> {
		const appended = await this.persistence.appendJournalOnly({ sessionId: id, entry, expectedRevision });
		if (appended.isOk()) {
			try {
				this.onEntryCommitted?.(id, entry);
			} catch {
				// Projection observers never invalidate a durable append.
			}
			return appended.value;
		}
		throw new RuntimeSessionStoreWriteFailed({
			message: `Could not append an entry to journal-only Session "${id}"`,
			sessionId: id,
			cause: appended.error,
		});
	}

	async delete(id: string): Promise<void> {
		throw new RuntimeSessionStoreDeleteUnsupported({
			message: `Journal-only Session "${id}" cannot be deleted through the store adapter`,
			sessionId: id,
		});
	}
}
