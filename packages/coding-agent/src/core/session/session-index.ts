import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL DEFAULT 'default',
  file_path     TEXT,
  title         TEXT,
  model         TEXT,
  first_message TEXT,
  message_count INTEGER DEFAULT 0,
  total_tokens  INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace ON sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_updated   ON sessions(updated_at DESC);
`;

export interface SessionInfo {
	sessionId: string;
	workspaceId: string;
	/** session 文件的绝对路径；老记录可能为 null（按 workspaceId 兜底推导）。 */
	filePath: string | null;
	title: string | null;
	model: string | null;
	firstMessage: string | null;
	messageCount: number;
	totalTokens: number;
	createdAt: number;
	updatedAt: number;
}

interface RawRow {
	session_id: string;
	workspace_id: string;
	file_path: string | null;
	title: string | null;
	model: string | null;
	first_message: string | null;
	message_count: number;
	total_tokens: number;
	created_at: number;
	updated_at: number;
}

function rowToRecord(row: RawRow): SessionInfo {
	return {
		sessionId: row.session_id,
		workspaceId: row.workspace_id,
		filePath: row.file_path,
		title: row.title,
		model: row.model,
		firstMessage: row.first_message,
		messageCount: row.message_count,
		totalTokens: row.total_tokens,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class SessionIndex {
	private db: Database;

	private constructor(db: Database) {
		this.db = db;
	}

	static async open(dbPath: string): Promise<SessionIndex> {
		await mkdir(dirname(dbPath), { recursive: true });
		const db = new Database(dbPath);
		db.exec("PRAGMA journal_mode=WAL");
		db.exec(SCHEMA);
		// 老数据库迁移：补 file_path 列（SQLite 的 IF NOT EXISTS 不支持 ALTER，手动探测）。
		const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
		if (!cols.some((c) => c.name === "file_path")) {
			db.exec("ALTER TABLE sessions ADD COLUMN file_path TEXT");
		}
		return new SessionIndex(db);
	}

	upsert(record: SessionInfo): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO sessions
				(session_id, workspace_id, file_path, title, model, first_message, message_count, total_tokens, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.sessionId,
				record.workspaceId,
				record.filePath,
				record.title,
				record.model,
				record.firstMessage,
				record.messageCount,
				record.totalTokens,
				record.createdAt,
				record.updatedAt,
			);
	}

	get(sessionId: string): SessionInfo | null {
		const row = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as RawRow | null;
		return row ? rowToRecord(row) : null;
	}

	list(options?: { workspaceId?: string; limit?: number; offset?: number }): SessionInfo[] {
		const { workspaceId, limit = 100, offset = 0 } = options ?? {};

		if (workspaceId) {
			const rows = this.db
				.prepare("SELECT * FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?")
				.all(workspaceId, limit, offset) as RawRow[];
			return rows.map(rowToRecord);
		}

		const rows = this.db
			.prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?")
			.all(limit, offset) as RawRow[];
		return rows.map(rowToRecord);
	}

	delete(sessionId: string): boolean {
		const result = this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
		return result.changes > 0;
	}

	updateField(sessionId: string, field: keyof SessionInfo, value: string | number | null): void {
		const columnMap: Record<string, string> = {
			title: "title",
			model: "model",
			firstMessage: "first_message",
			messageCount: "message_count",
			totalTokens: "total_tokens",
			updatedAt: "updated_at",
			filePath: "file_path",
		};

		const column = columnMap[field];
		if (!column) return;

		this.db
			.prepare(`UPDATE sessions SET ${column} = ?, updated_at = ? WHERE session_id = ?`)
			.run(value, Date.now(), sessionId);
	}

	close(): void {
		this.db.close();
	}
}
