import type { JsonObject } from "../../../core/agent-state";
import type { SessionStore } from "../types";

/**
 * 进程内按 session id 排队，消除同进程写者之间的 revision 冲突。
 * 跨进程互斥是另一个问题，只能由具体实现（文件锁 / 事务）解决。
 */
export function serialized<T extends JsonObject>(store: SessionStore<T>): SessionStore<T> {
	const queues = new Map<string, Promise<unknown>>();

	const enqueue = <R>(id: string, task: () => Promise<R>): Promise<R> => {
		const previous = queues.get(id) ?? Promise.resolve();
		const next = previous.then(task, task);
		queues.set(
			id,
			next.catch(() => {}),
		);
		return next;
	};

	return {
		load: (id) => enqueue(id, () => store.load(id)),
		create: (id, init) => enqueue(id, () => store.create(id, init)),
		append: (id, entry, revision) => enqueue(id, () => store.append(id, entry, revision)),
		delete: (id) => enqueue(id, () => store.delete(id)),
		list: () => store.list(),
		follow: (id, afterEntryId, listener) => store.follow(id, afterEntryId, listener),
	};
}
