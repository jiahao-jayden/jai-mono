import type { Usage } from "@jai/ai";
import type { JsonObject } from "../../core/agent-state";
import type { AgentMessage } from "../../core/types";

export interface MessageEntry {
	type: "message";
	id: string;
	timestamp: string;
	message: AgentMessage;
}

export interface AppStateEntry<TAppState extends JsonObject = JsonObject> {
	type: "app_state";
	id: string;
	timestamp: string;
	value: TAppState;
}

/**
 * 一次压缩的事实：摘要文本，加上"从哪条 message entry 开始保留原文"。
 * 原始 message entry 一条不删，压缩只是叠加一层新的读取视角。
 */
export interface CompactionEntry {
	type: "compaction";
	id: string;
	timestamp: string;
	summary: string;
	/** 摘要之后第一条保留原文的 message entry id */
	firstKeptEntryId: string;
	tokensBefore: number;
	tokensAfter: number;
	/** 生成这条摘要本身花掉的 tokens */
	usage: Usage;
}

/** 一次 session 变更的最小事实单位 */
export type SessionEntry<TAppState extends JsonObject = JsonObject> =
	| MessageEntry
	| AppStateEntry<TAppState>
	| CompactionEntry;

export interface SessionSnapshot<TAppState extends JsonObject = JsonObject> {
	systemPrompt: string;
	entries: SessionEntry<TAppState>[];
	appState: TAppState;
	createdAt: string;
	updatedAt: string;
}

export interface SessionInit<TAppState extends JsonObject = JsonObject> {
	systemPrompt: string;
	appState: TAppState;
}

export interface StoredSession<TAppState extends JsonObject = JsonObject> {
	snapshot: SessionSnapshot<TAppState>;
	revision: string;
	/** 存在本版本无法解释的 entry 时为 true，此时禁止写入。 */
	readOnly: boolean;
}

/**
 * append-only 存储契约。没有"整份覆盖写"：创建走 create()，
 * 导入外部 snapshot 是独立工具函数，不进核心接口。
 */
export interface SessionStore<TAppState extends JsonObject = JsonObject> {
	load(id: string): Promise<StoredSession<TAppState> | undefined>;
	/** 仅当 session 不存在时创建，返回初始 revision。 */
	create(id: string, init: SessionInit<TAppState>): Promise<string>;
	append(id: string, entry: SessionEntry<TAppState>, expectedRevision: string): Promise<string>;
	list(): Promise<string[]>;
}

/** 持有 revision 的写入句柄，调用方因此不必手工接力 revision。 */
export interface SessionHandle<TAppState extends JsonObject = JsonObject> {
	readonly id: string;
	readonly snapshot: SessionSnapshot<TAppState>;
	readonly readOnly: boolean;
	append(entry: SessionEntry<TAppState>): Promise<void>;
}

export class SessionConflictError extends Error {
	override name = "SessionConflictError";
}

export class SessionBusyError extends Error {
	override name = "SessionBusyError";
}

export class SessionReadOnlyError extends Error {
	override name = "SessionReadOnlyError";
}
