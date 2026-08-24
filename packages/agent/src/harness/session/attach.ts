import { Result } from "better-result";
import type { JsonObject } from "../../core/agent-state";
import { applyEntry } from "./snapshot";
import type { SessionFollowListener, SessionSnapshot, SessionStore } from "./types";
import { type SessionFollowLost, SessionNotFound } from "./types";

export interface ReadOnlySessionAttachment<TAppState extends JsonObject> {
	readonly id: string;
	readonly snapshot: SessionSnapshot<TAppState>;
	onChange(listener: (snapshot: SessionSnapshot<TAppState>) => void): () => void;
	/** 跟读中断（session 被删、游标失效、账本无法解析）后不会再有更新。 */
	onLost(listener: (error: SessionFollowLost) => void): () => void;
	close(): void;
}

export async function attachSession<TAppState extends JsonObject>(
	store: SessionStore<TAppState>,
	id: string,
): Promise<Result<ReadOnlySessionAttachment<TAppState>, SessionNotFound>> {
	const record = await store.load(id);
	if (!record) {
		return Result.err(new SessionNotFound({ message: `Session "${id}" does not exist`, id }));
	}
	let snapshot = structuredClone(record.snapshot);
	let closed = false;
	const listeners = new Set<(snapshot: SessionSnapshot<TAppState>) => void>();
	const lostListeners = new Set<(error: SessionFollowLost) => void>();
	const notify: SessionFollowListener<TAppState> = (update) => {
		if (closed) return;
		if (update.isErr()) {
			// 跟读断了就不会再有更新，旁观者必须听得见，否则界面会停在最后一帧假装还活着。
			closed = true;
			for (const listener of lostListeners) listener(update.error);
			return;
		}
		for (const entry of update.value.entries) snapshot = applyEntry(snapshot, structuredClone(entry));
		for (const listener of listeners) listener(structuredClone(snapshot));
	};
	const afterEntryId = snapshot.entries.at(-1)?.id;
	const stop = store.follow(id, afterEntryId, notify);
	return Result.ok({
		id,
		get snapshot() {
			return structuredClone(snapshot);
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		onLost(listener) {
			lostListeners.add(listener);
			return () => lostListeners.delete(listener);
		},
		close() {
			if (closed) return;
			closed = true;
			stop();
			listeners.clear();
			lostListeners.clear();
		},
	});
}
