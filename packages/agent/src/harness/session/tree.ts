import { TaggedError } from "better-result";
import type { JsonObject } from "../../core/agent-state";
import type { AgentMessage } from "../../core/types";
import type { SessionEntry, TreeEntry } from "./types";

/**
 * 父链走不通。我们自己的写者产生不了这种树（id 唯一、parentId 指向写入时已存在的
 * entry），但两个进程并发铸同一个 id、或手改过 / 截断过的文件可以。
 */
export class BrokenSessionTree extends TaggedError("session.broken_tree")<{
	readonly message: string;
	readonly leafId: string;
	readonly entryId: string;
}> {}

/**
 * leaf → root 走一遍，返回 root → leaf 顺序的线性分支。
 *
 * 抛而不是返回 Result：没有调用方能对一条残缺分支做任何有用的事，而**静默截断
 * 等于把残缺对话发给模型**，比直接失败糟得多。file.ts 的 load 今天就让 replay
 * 抛，同类。
 */
export function branchOf<TAppState extends JsonObject>(
	entries: readonly SessionEntry<TAppState>[],
	leafId: string | null,
): TreeEntry<TAppState>[] {
	if (leafId === null) return [];

	const byId = new Map<string, TreeEntry<TAppState>>();
	for (const entry of entries) byId.set(entry.id, entry);

	const branch: TreeEntry<TAppState>[] = [];
	const visited = new Set<string>();
	let cursor: string | null = leafId;
	while (cursor !== null) {
		if (visited.has(cursor)) {
			throw new BrokenSessionTree({
				message: `Session tree has a cycle through entry "${cursor}"`,
				leafId,
				entryId: cursor,
			});
		}
		visited.add(cursor);
		const entry: TreeEntry<TAppState> | undefined = byId.get(cursor);
		if (!entry) {
			throw new BrokenSessionTree({
				message: `Session tree is missing entry "${cursor}"`,
				leafId,
				entryId: cursor,
			});
		}
		branch.push(entry);
		cursor = entry.parentId;
	}
	return branch.reverse();
}

/**
 * 模型可见的 transcript：分支线性化后与 CoreAgent.state.messages 一一对齐。
 * 所有 entries→messages 的转换都走这里，别在调用点各写一遍 type === "message"。
 *
 * `branch` 只移动当前 leaf，不把已放弃的内容带进新的模型上下文。
 */
export function contextMessageOf<TAppState extends JsonObject>(entry: TreeEntry<TAppState>): AgentMessage | undefined {
	if (entry.type === "message") return entry.message;
	return undefined;
}

export function contextMessages<TAppState extends JsonObject>(branch: readonly TreeEntry<TAppState>[]): AgentMessage[] {
	return contextEntries(branch).map((entry) => entry.message);
}

/** entry id 与它在 transcript 中的位置的对应关系。压缩的切点全部按这个序列定位。 */
export interface ContextEntry {
	id: string;
	message: AgentMessage;
}

export function contextEntries<TAppState extends JsonObject>(
	entries: readonly SessionEntry<TAppState>[],
): ContextEntry[] {
	return entries.flatMap((entry) => {
		const message = contextMessageOf(entry);
		return message ? [{ id: entry.id, message }] : [];
	});
}
