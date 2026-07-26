import { cloneJson, type JsonObject } from "../../core/agent-state";
import type { SessionEntry, SessionInit, SessionSnapshot } from "./types";

export function emptySnapshot<T extends JsonObject>(init: SessionInit<T>, now: string): SessionSnapshot<T> {
	return {
		systemPrompt: init.systemPrompt,
		entries: [],
		appState: cloneJson(init.appState),
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
	const next: SessionSnapshot<T> = {
		...snapshot,
		entries: [...snapshot.entries, entry],
		updatedAt: entry.timestamp,
	};

	switch (entry.type) {
		case "message":
		case "compaction":
			return next;
		case "app_state":
			return { ...next, appState: cloneJson(entry.value) };
	}
}

export function replay<T extends JsonObject>(
	init: SessionInit<T>,
	entries: SessionEntry<T>[],
	createdAt: string,
): SessionSnapshot<T> {
	return entries.reduce<SessionSnapshot<T>>(applyEntry, emptySnapshot(init, createdAt));
}
