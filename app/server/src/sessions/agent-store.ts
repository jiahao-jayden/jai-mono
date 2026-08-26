import {
	type JsonObject,
	type SessionEntry,
	type SessionFollowListener,
	SessionFollowLost,
	type SessionStore,
	type StoredSession,
} from "@jai/agent";
import { Result, TaggedError } from "better-result";
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
		private readonly cwd: string,
		private readonly now: () => Date = () => new Date(),
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

	async list(): Promise<string[]> {
		const listed = await this.persistence.list();
		if (listed.isErr()) {
			throw new RuntimeSessionStoreWriteFailed({
				message: "Could not list Sessions through the Runtime Host store adapter",
				sessionId: "",
				cause: listed.error,
			});
		}
		return listed.value.map((session) => session.id);
	}

	async delete(id: string): Promise<void> {
		throw new RuntimeSessionStoreDeleteUnsupported({
			message: `Runtime Host does not support deleting durable Session "${id}"`,
			sessionId: id,
		});
	}

	follow(id: string, afterEntryId: string | undefined, listener: SessionFollowListener<TAppState>): () => void {
		let closed = false;
		let cursor = afterEntryId;
		let tail = Promise.resolve();
		const reload = (): void => {
			tail = tail.then(async () => {
				if (closed) return;
				const loaded = await this.load(id);
				if (!loaded) {
					listener(Result.err(new SessionFollowLost({ message: `Session "${id}" does not exist`, afterEntryId: cursor ?? "" })));
					closed = true;
					return;
				}
				const start = cursor === undefined ? 0 : loaded.snapshot.entries.findIndex((entry) => entry.id === cursor) + 1;
				if (cursor !== undefined && start === 0) {
					listener(Result.err(new SessionFollowLost({ message: `Entry "${cursor}" was not found`, afterEntryId: cursor })));
					closed = true;
					return;
				}
				const entries = loaded.snapshot.entries.slice(start);
				if (entries.length === 0) return;
				cursor = entries.at(-1)?.id;
				listener(Result.ok({ entries, revision: loaded.revision, lastEntryId: cursor! }));
			});
		};
		const interval = setInterval(reload, 250);
		reload();
		return () => {
			closed = true;
			clearInterval(interval);
		};
	}
}
