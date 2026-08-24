import { cloneJson, type JsonObject } from "../../core/agent-state";
import { branchOf } from "./tree";
import type { SessionEntry, SessionSnapshot } from "./types";

export function emptySnapshot<T extends JsonObject>(appState: T, now: string): SessionSnapshot<T> {
	return {
		entries: [],
		leafId: null,
		appState: cloneJson(appState),
		initialAppState: cloneJson(appState),
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * "一条 entry 如何影响 snapshot" 的唯一实现：所有 store 与测试共用它，
 * 新增 entry 类型时也只改这里。纯函数，不碰 IO。
 */
export function applyEntry<T extends JsonObject>(
	snapshot: SessionSnapshot<T>,
	entry: SessionEntry<T>,
): SessionSnapshot<T> {
	const entries = [...snapshot.entries, entry];

	const next: SessionSnapshot<T> = { ...snapshot, entries, leafId: entry.id, updatedAt: entry.timestamp };
	if (entry.type === "app_state") return { ...next, appState: cloneJson(entry.value) };

	// parentId !== 当前 leaf ⇔ 刚刚发生过一次导航，增量折叠出来的 appState 说的是
	// 另一条路，必须从 header 初值沿新分支重算。
	return entry.parentId === snapshot.leafId
		? next
		: { ...next, appState: branchAppState(entries, entry.id, snapshot.initialAppState) };
}

function branchAppState<T extends JsonObject>(entries: readonly SessionEntry<T>[], leafId: string, initial: T): T {
	let appState = initial;
	for (const entry of branchOf(entries, leafId)) if (entry.type === "app_state") appState = entry.value;
	return cloneJson(appState);
}

export function replay<T extends JsonObject>(
	appState: T,
	entries: SessionEntry<T>[],
	createdAt: string,
): SessionSnapshot<T> {
	return entries.reduce<SessionSnapshot<T>>(applyEntry, emptySnapshot(appState, createdAt));
}
