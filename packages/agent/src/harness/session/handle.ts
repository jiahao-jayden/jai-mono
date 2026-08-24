import { TaggedError } from "better-result";
import type { JsonObject } from "../../core/agent-state";
import { findUnresolvedToolCalls, interruptedToolResult } from "../../core/tool-protocol";
import { applyEntry } from "./snapshot";
import { branchOf, contextMessages } from "./tree";
import { type SessionHandle, SessionReadOnlyError, type SessionStore } from "./types";

class SessionDisappeared extends TaggedError("session.disappeared")<{ readonly message: string }> {}

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
		if (!record) {
			throw new SessionDisappeared({
				message: `Session "${id}" disappeared right after creation`,
			});
		}
	}

	let snapshot = record.snapshot;
	let revision = record.revision;
	const readOnly = record.readOnly;
	if (!readOnly) {
		// 只扫当前分支：整棵树里补 interrupted，会给被抛弃分支上的 tool call
		// 补出永远读不到的结果。补出的 entry 自身也是树节点，带 parentId、推进 leaf。
		for (const call of findUnresolvedToolCalls(contextMessages(branchOf(snapshot.entries, snapshot.leafId)))) {
			const entry = {
				type: "message" as const,
				id: `${id}:interrupted:${call.toolCallId}`,
				parentId: snapshot.leafId,
				timestamp: new Date().toISOString(),
				message: interruptedToolResult(call),
			};
			revision = await store.append(id, entry, revision);
			snapshot = applyEntry(snapshot, entry);
		}
	}

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
