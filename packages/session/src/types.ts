import type { Message } from "@jayden/jai-ai";

export type SessionHeader = {
	type: "session";
	id: string;
	parentId: null;
	version: 1;
	sessionId: string;
	timestamp: number;
	cwd?: string;
};

export type MessageEntry = {
	type: "message";
	id: string;
	parentId: string;
	timestamp: number;
	message: Message;
};

export type CompactionEntry = {
	type: "compaction";
	id: string;
	parentId: string;
	timestamp: number;
	summary: string;
	firstKeptEntryId: string;
	/**
	 * 仅在 split-turn 场景下存在（最后一个 turn 过大、必须从 turn 内部切）。
	 * 保存被切掉的 turn 前缀的独立摘要，由 buildSessionContext 拼进 wrapped-summary 回放。
	 */
	turnPrefixSummary?: string;
};

export type SessionEntry = SessionHeader | MessageEntry | CompactionEntry;

export type SessionInfo = {
	sessionId: string;
	timestamp: number;
	lastActivity: number;
	messageCount: number;
	cwd?: string;
};

export interface SessionStore {
	append(entry: SessionEntry): Promise<void>;
	getBranch(leafId?: string): SessionEntry[];
	getAllEntries(): SessionEntry[];
	nextId(): string;
	list(): Promise<SessionInfo[]>;
	close(): Promise<void>;
}
