import { Result } from "better-result";
import type { JsonObject } from "../../../core/agent-state";
import { applyEntry, emptySnapshot } from "../snapshot";
import {
	SessionConflictError,
	type SessionEntry,
	type SessionFollowListener,
	SessionFollowLost,
	type SessionStore,
	type StoredSession,
} from "../types";

export class InMemorySessionStore<TAppState extends JsonObject = JsonObject> implements SessionStore<TAppState> {
	private readonly records = new Map<string, StoredSession<TAppState>>();
	private readonly followers = new Map<string, Set<SessionFollowListener<TAppState>>>();

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
		this.notify(id, [entry], revision);
		return revision;
	}

	async list(): Promise<string[]> {
		return [...this.records.keys()];
	}

	/**
	 * 删除必须把跟读者一起断开：同一个 id 之后可以再被 create() 出来，
	 * 留着的 listener 会把新会话的 entry 当成旧会话的续写投递出去。
	 */
	async delete(id: string): Promise<void> {
		if (!this.records.delete(id)) return;

		const listeners = this.followers.get(id);
		if (!listeners) return;
		this.followers.delete(id);
		for (const listener of listeners) {
			listener(Result.err(new SessionFollowLost({ message: `Session "${id}" was deleted`, afterEntryId: "" })));
		}
	}

	follow(id: string, afterEntryId: string | undefined, listener: SessionFollowListener<TAppState>): () => void {
		const record = this.records.get(id);
		if (!record) {
			listener(
				Result.err(
					new SessionFollowLost({ message: `Session "${id}" does not exist`, afterEntryId: afterEntryId ?? "" }),
				),
			);
			return () => {};
		}
		const start =
			afterEntryId === undefined ? 0 : record.snapshot.entries.findIndex((entry) => entry.id === afterEntryId) + 1;
		if (afterEntryId !== undefined && start === 0) {
			listener(
				Result.err(new SessionFollowLost({ message: `Entry "${afterEntryId}" was not found`, afterEntryId })),
			);
			return () => {};
		}
		const entries = record.snapshot.entries.slice(start);
		if (entries.length > 0)
			listener(Result.ok({ entries, revision: record.revision, lastEntryId: entries.at(-1)!.id }));
		const listeners = this.followers.get(id) ?? new Set();
		listeners.add(listener);
		this.followers.set(id, listeners);
		return () => {
			listeners.delete(listener);
			// 只在 map 里还挂着自己这一份时才摘掉：delete + 重建之后 map 已经换成新会话的
			// set，此时清掉会连带把新跟读者一起断开。
			if (listeners.size === 0 && this.followers.get(id) === listeners) this.followers.delete(id);
		};
	}

	private notify(id: string, entries: readonly SessionEntry<TAppState>[], revision: string): void {
		if (entries.length === 0) return;
		const listeners = this.followers.get(id);
		if (!listeners) return;
		const update = Result.ok({ entries: structuredClone(entries), revision, lastEntryId: entries.at(-1)!.id });
		for (const listener of listeners) listener(update);
	}
}
