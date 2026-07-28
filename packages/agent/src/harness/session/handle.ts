import type { JsonObject } from "../../core/agent-state";
import { applyEntry } from "./snapshot";
import { type SessionHandle, SessionReadOnlyError, type SessionStore } from "./types";

/** 不存在则创建，存在则载入；revision 从此由 handle 内部维护。 */
export async function openSession<TAppState extends JsonObject>(
	store: SessionStore<TAppState>,
	id: string,
	appState: TAppState,
): Promise<SessionHandle<TAppState>> {
	let record = await store.load(id);
	if (!record) {
		await store.create(id, appState);
		record = await store.load(id);
		if (!record) throw new Error(`Session "${id}" disappeared right after creation`);
	}

	let snapshot = record.snapshot;
	let revision = record.revision;
	const readOnly = record.readOnly;

	// revision 归 handle 管，读-改-写的串行化也归它管：
	// 并发 append 排成一条链，每个任务执行时才读取上一次写入推进后的 revision。
	let tail: Promise<void> = Promise.resolve();

	return {
		id,
		readOnly,
		get snapshot() {
			return snapshot;
		},
		append(entry) {
			if (readOnly) throw new SessionReadOnlyError(`Session "${id}" is read-only`);

			const next = tail.then(async () => {
				revision = await store.append(id, entry, revision);
				snapshot = applyEntry(snapshot, entry);
			});
			tail = next.catch(() => {});
			return next;
		},
	};
}
