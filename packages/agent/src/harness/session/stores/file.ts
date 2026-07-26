import fs from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import type { JsonObject } from "../../../core/agent-state";
import { replay } from "../snapshot";
import {
	SessionBusyError,
	SessionConflictError,
	type SessionEntry,
	type SessionInit,
	SessionReadOnlyError,
	type SessionStore,
	type StoredSession,
} from "../types";

const SCHEMA_VERSION = 1;
const VALID_ID = /^[A-Za-z0-9._-]+$/;

interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	revision: string;
	systemPrompt: string;
	appState: JsonObject;
	createdAt: string;
}

interface ParsedFile<TAppState extends JsonObject> {
	header: SessionHeader;
	entries: SessionEntry<TAppState>[];
	revision: string;
	readOnly: boolean;
}

/** 一个 session 一个 JSONL 文件：首行是 header，之后每次提交是 entry 行 + revision 行。 */
export class FileSessionStore<TAppState extends JsonObject = JsonObject> implements SessionStore<TAppState> {
	constructor(private readonly directory: string) {}

	async load(id: string): Promise<StoredSession<TAppState> | undefined> {
		const parsed = await this.parse(id);
		if (!parsed) return undefined;

		return {
			snapshot: replay<TAppState>(
				{ systemPrompt: parsed.header.systemPrompt, appState: parsed.header.appState as TAppState },
				parsed.entries,
				parsed.header.createdAt,
			),
			revision: parsed.revision,
			readOnly: parsed.readOnly,
		};
	}

	async create(id: string, init: SessionInit<TAppState>): Promise<string> {
		await fs.mkdir(this.directory, { recursive: true });

		return this.withExclusiveLock(id, async () => {
			if (await this.exists(id)) {
				throw new SessionConflictError(`Session "${id}" already exists`);
			}

			const revision = crypto.randomUUID();
			const header: SessionHeader = {
				type: "session",
				version: SCHEMA_VERSION,
				id,
				revision,
				systemPrompt: init.systemPrompt,
				appState: init.appState,
				createdAt: new Date().toISOString(),
			};

			await this.writeAtomically(id, `${JSON.stringify(header)}\n`);
			return revision;
		});
	}

	async append(id: string, entry: SessionEntry<TAppState>, expectedRevision: string): Promise<string> {
		return this.withExclusiveLock(id, async () => {
			const current = await this.parse(id);
			if (!current) throw new SessionConflictError(`Session "${id}" does not exist`);
			if (current.revision !== expectedRevision) {
				throw new SessionConflictError(`Session "${id}" revision conflict`);
			}
			if (current.readOnly) {
				throw new SessionReadOnlyError(`Session "${id}" contains entries written by a newer version`);
			}

			const revision = crypto.randomUUID();
			const commit = `${JSON.stringify(entry)}\n${JSON.stringify({ type: "revision", value: revision })}\n`;
			await this.appendAtomically(id, commit);
			return revision;
		});
	}

	async list(): Promise<string[]> {
		const files = await fs.readdir(this.directory).catch(toUndefinedOnMissing);
		return (files ?? []).filter((file) => file.endsWith(".jsonl")).map((file) => file.slice(0, -".jsonl".length));
	}

	private filePath(id: string): string {
		if (!VALID_ID.test(id) || id === "." || id === "..") {
			throw new Error(`Invalid session id "${id}"`);
		}
		return path.join(this.directory, `${id}.jsonl`);
	}

	private async exists(id: string): Promise<boolean> {
		return fs
			.stat(this.filePath(id))
			.then(() => true)
			.catch(() => false);
	}

	/**
	 * 只重放"后面跟着 revision 行"的完整提交，崩溃留下的尾部半条提交被忽略。
	 * 无法解释的 entry 不丢弃数据，但会把 session 降级为只读。
	 */
	private async parse(id: string): Promise<ParsedFile<TAppState> | undefined> {
		const raw = await fs.readFile(this.filePath(id), "utf8").catch(toUndefinedOnMissing);
		if (raw === undefined) return undefined;

		const lines = raw.split("\n");
		const header = parseHeader(lines[0], id);

		const entries: SessionEntry<TAppState>[] = [];
		let pending: SessionEntry<TAppState>[] = [];
		let revision = header.revision;
		let readOnly = false;

		let lastLine = lines.length - 1;
		while (lastLine > 0 && !lines[lastLine]?.trim()) lastLine--;

		for (let index = 1; index < lines.length; index++) {
			const line = lines[index]?.trim();
			if (!line) continue;

			const record = tryParseLine(line);
			if (!record) {
				// 尾行可能是崩溃时写了一半；中间的坏行则说明文件真的损坏了。
				if (index === lastLine) break;
				throw new Error(`Corrupted session file "${id}" at line ${index + 1}`);
			}

			if (record.type === "revision") {
				entries.push(...pending);
				pending = [];
				revision = String(record.value);
				continue;
			}

			if (record.type === "message" || record.type === "app_state" || record.type === "compaction") {
				pending.push(record as unknown as SessionEntry<TAppState>);
				continue;
			}

			readOnly = true;
		}

		return { header, entries, revision, readOnly };
	}

	private async writeAtomically(id: string, content: string): Promise<void> {
		const target = this.filePath(id);
		const temp = `${target}.${crypto.randomUUID()}.tmp`;
		const handle = await fs.open(temp, "wx");
		try {
			await handle.writeFile(content);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fs.rename(temp, target);
	}

	private async appendAtomically(id: string, content: string): Promise<void> {
		const handle = await fs.open(this.filePath(id), "a");
		try {
			await handle.writeFile(content);
			await handle.sync();
		} finally {
			await handle.close();
		}
	}

	/** 锁必须覆盖 "读 revision → 比较 → 写入" 整段，否则存在 TOCTOU race。 */
	private async withExclusiveLock<T>(id: string, task: () => Promise<T>): Promise<T> {
		const lockPath = `${this.filePath(id)}.lock`;
		await this.acquireLock(lockPath);
		try {
			return await task();
		} finally {
			await fs.rm(lockPath, { force: true });
		}
	}

	private async acquireLock(lockPath: string, reclaimed = false): Promise<void> {
		try {
			const handle = await fs.open(lockPath, "wx");
			await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), createdAt: Date.now() }));
			await handle.close();
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}

		if (reclaimed || !(await this.isStaleLock(lockPath))) {
			throw new SessionBusyError(`Session lock is held: ${lockPath}`);
		}

		await fs.rm(lockPath, { force: true });
		await this.acquireLock(lockPath, true);
	}

	/** 只回收"能证明已失效"的锁：同主机且进程已不存在。 */
	private async isStaleLock(lockPath: string): Promise<boolean> {
		const raw = await fs.readFile(lockPath, "utf8").catch(toUndefinedOnMissing);
		if (raw === undefined) return true;

		const owner = tryParseLine(raw);
		if (!owner || owner.host !== hostname() || typeof owner.pid !== "number") return false;

		try {
			process.kill(owner.pid, 0);
			return false;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH";
		}
	}
}

function parseHeader(line: string | undefined, id: string): SessionHeader {
	const header = line ? tryParseLine(line) : undefined;
	if (!header || header.type !== "session") {
		throw new Error(`Session file "${id}" is missing its header`);
	}
	if (typeof header.version !== "number" || header.version > SCHEMA_VERSION) {
		throw new Error(`Session file "${id}" uses unsupported schema version ${String(header.version)}`);
	}
	return header as unknown as SessionHeader;
}

function tryParseLine(line: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(line);
		return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** 只有 ENOENT 才算"不存在"；权限等错误必须继续抛。 */
function toUndefinedOnMissing(error: unknown): undefined {
	if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
	throw error;
}
