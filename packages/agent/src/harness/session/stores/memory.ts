import type { JsonObject } from "../../../core/agent-state";
import { applyEntry, emptySnapshot } from "../snapshot";
import { SessionConflictError, type SessionEntry, type SessionStore, type StoredSession } from "../types";

export class InMemorySessionStore<TAppState extends JsonObject = JsonObject> implements SessionStore<TAppState> {
	private readonly records = new Map<string, StoredSession<TAppState>>();

	async load(id: string): Promise<StoredSession<TAppState> | undefined> {
		const record = this.records.get(id);
		return record ? structuredClone(record) : undefined;
	}

	async create(id: string, appState: TAppState): Promise<string> {
		if (this.records.has(id)) {
			throw new SessionConflictError(`Session "${id}" already exists`);
		}

		const revision = crypto.randomUUID();
		this.records.set(id, {
			snapshot: emptySnapshot(appState, new Date().toISOString()),
			revision,
			readOnly: false,
		});
		return revision;
	}

	async append(id: string, entry: SessionEntry<TAppState>, expectedRevision: string): Promise<string> {
		const current = this.records.get(id);
		if (!current) throw new SessionConflictError(`Session "${id}" does not exist`);
		if (current.revision !== expectedRevision) {
			throw new SessionConflictError(`Session "${id}" revision conflict`);
		}

		const revision = crypto.randomUUID();
		this.records.set(id, {
			snapshot: applyEntry(current.snapshot, structuredClone(entry)),
			revision,
			readOnly: false,
		});
		return revision;
	}

	async delete(id: string): Promise<void> {
		this.records.delete(id);
	}
}
