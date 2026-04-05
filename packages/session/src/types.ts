import type { Message } from "@jayden/jai-ai";

export type SessionHeader = {
	type: "session";
	id: string;
	parentId: null;
	version: 1;
	sessionId: string;
	timestamp: number;
	cwd?: string;
	model?: string;
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
};

export type SessionEntry = SessionHeader | MessageEntry | CompactionEntry;

export type SessionInfo = {
	sessionId: string;
	timestamp: number;
	lastActivity: number;
	messageCount: number;
	cwd?: string;
	model?: string;
};

export interface SessionStore {
	append(entry: SessionEntry): Promise<void>;
	getBranch(leafId?: string): SessionEntry[];
	getAllEntries(): SessionEntry[];
	nextId(): string;
	list(): Promise<SessionInfo[]>;
	close(): Promise<void>;
}
