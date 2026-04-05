import type { SessionEntry, SessionInfo, SessionStore } from "./types.js";

export class InMemorySessionStore implements SessionStore {
	private entries: SessionEntry[] = [];

	append(entry: SessionEntry): Promise<void> {
		this.entries.push(entry);
		return Promise.resolve();
	}

	getBranch(leafId?: string): SessionEntry[] {
		if (this.entries.length === 0) return [];

		const leaf = leafId ?? this.entries[this.entries.length - 1].id;

		// 建立索引
		const byId = new Map<string, SessionEntry>();
		for (const e of this.entries) {
			byId.set(e.id, e);
		}

		// Search for the leaf and build the path
		const path: SessionEntry[] = [];
		let currentId: string | null = leaf;

		while (currentId !== null) {
			const entry = byId.get(currentId);
			if (!entry) break;
			path.push(entry);
			currentId = entry.parentId;
		}
		path.reverse();
		return path;
	}

	getAllEntries(): SessionEntry[] {
		return [...this.entries];
	}

	nextId(): string {
		return crypto.randomUUID();
	}

	async list(): Promise<SessionInfo[]> {
		const sessions = new Map<string, SessionInfo>();
		// session header 的 id → sessionId 映射
		const headerIdToSessionId = new Map<string, string>();

		for (const entry of this.entries) {
			if (entry.type === "session") {
				headerIdToSessionId.set(entry.id, entry.sessionId);
				sessions.set(entry.sessionId, {
					sessionId: entry.sessionId,
					timestamp: entry.timestamp,
					lastActivity: entry.timestamp,
					messageCount: 0,
					cwd: entry.cwd,
					model: entry.model,
				});
			}
		}

		// 建索引，用于沿 parentId 往上查找所属 session
		const byId = new Map<string, SessionEntry>();
		for (const e of this.entries) {
			byId.set(e.id, e);
		}

		// 缓存：entry id → 所属的 sessionId
		const ownerCache = new Map<string, string>();

		const findOwnerSession = (entryId: string): string | undefined => {
			if (ownerCache.has(entryId)) return ownerCache.get(entryId);

			let currentId: string | null = entryId;
			const visited: string[] = [];

			while (currentId != null) {
				if (ownerCache.has(currentId)) {
					const sid = ownerCache.get(currentId)!;
					for (const v of visited) ownerCache.set(v, sid);
					return sid;
				}
				if (headerIdToSessionId.has(currentId)) {
					const sid = headerIdToSessionId.get(currentId)!;
					visited.push(currentId);
					for (const v of visited) ownerCache.set(v, sid);
					return sid;
				}
				visited.push(currentId);
				const entry = byId.get(currentId);
				if (!entry) break;
				currentId = entry.parentId;
			}
			return undefined;
		};

		for (const entry of this.entries) {
			if (entry.type !== "message") continue;
			const sessionId = findOwnerSession(entry.id);
			if (!sessionId) continue;
			const info = sessions.get(sessionId);
			if (!info) continue;
			info.messageCount++;
			if (entry.timestamp > info.lastActivity) {
				info.lastActivity = entry.timestamp;
			}
		}

		return [...sessions.values()];
	}
	async close(): Promise<void> {
		this.entries = [];
	}
}
