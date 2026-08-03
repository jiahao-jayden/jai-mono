import fs from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import type { JsonObject, SessionSnapshot } from "@jai/agent";
import { FileSessionStore } from "@jai/agent/node";
import { getErrorCode } from "@jai/common";
import {
	sessionBusyError,
	sessionFileConflictError,
	sessionFileMissingError,
	sessionNotFoundError,
	storageInconsistentError,
	workspaceNotFoundError,
	workspacePathInvalidError,
} from "./errors";
import type { CodingBusinessRepository } from "./repository";
import type {
	CodingExecutionContext,
	CodingSession,
	CreateSessionInput,
	CreateWorkspaceInput,
	MoveSessionInput,
	ProviderModelInventory,
	SessionListCursor,
	SessionListPage,
	SessionWorkspaceHistory,
	Workspace,
} from "./types";

const UNASSIGNED_DIRECTORY = "_unassigned";

export interface CodingBusinessServiceOptions {
	readonly dataRoot?: string;
	readonly now?: () => number;
	readonly createId?: () => string;
}

export class CodingBusinessService {
	readonly repository: CodingBusinessRepository;
	readonly dataRoot: string;
	readonly #now: () => number;
	readonly #createId: () => string;

	constructor(repository: CodingBusinessRepository, options: CodingBusinessServiceOptions = {}) {
		this.repository = repository;
		this.dataRoot = path.resolve(options.dataRoot ?? path.join(homedir(), "jai", "workspace"));
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? crypto.randomUUID;
	}

	static async open(options: CodingBusinessServiceOptions = {}): Promise<CodingBusinessService> {
		const dataRoot = path.resolve(options.dataRoot ?? path.join(homedir(), "jai", "workspace"));
		const { SqliteCodingBusinessRepository } = await import("./sqlite-repository");
		const repository = await SqliteCodingBusinessRepository.open(path.join(dataRoot, "data.sqlite"));
		return new CodingBusinessService(repository, { ...options, dataRoot });
	}

	async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
		const location = await resolveWorkspaceLocation(input.path, input.displayName);
		return this.repository.createWorkspace({
			id: this.#createId(),
			...location,
			now: this.#now(),
		});
	}

	async relinkWorkspace(workspaceId: string, input: CreateWorkspaceInput): Promise<Workspace> {
		if (!this.repository.getWorkspace(workspaceId)) throw workspaceNotFoundError(workspaceId);
		const location = await resolveWorkspaceLocation(input.path, input.displayName);
		return this.repository.relinkWorkspace(workspaceId, {
			...location,
			now: this.#now(),
		});
	}

	getProviderModelInventory(profileId: string): ProviderModelInventory | undefined {
		return this.repository.getProviderModelInventory(profileId);
	}

	replaceProviderModelInventory(profileId: string, modelIds: readonly string[]): ProviderModelInventory {
		return this.repository.replaceProviderModelInventory({
			profileId,
			modelIds,
			fetchedAt: this.#now(),
		});
	}

	deleteProviderModelInventory(profileId: string): void {
		this.repository.deleteProviderModelInventory(profileId);
	}

	renameProviderModelInventory(fromProfileId: string, toProfileId: string): void {
		this.repository.renameProviderModelInventory(fromProfileId, toProfileId);
	}

	async createSession<TAppState extends JsonObject = JsonObject>(
		input: CreateSessionInput<TAppState>,
	): Promise<CodingSession> {
		const workspaceId = input.workspaceId ?? null;
		if (workspaceId !== null && !this.repository.getWorkspace(workspaceId)) {
			throw workspaceNotFoundError(workspaceId);
		}
		const id = this.#createId();
		const directory = this.sessionDirectory(workspaceId);
		const store = new FileSessionStore<TAppState>(directory);
		await store.create(id, input.appState ?? ({} as TAppState));
		try {
			return this.repository.createSession({
				id,
				workspaceId,
				title: fallbackTitle(input.firstMessage),
				now: this.#now(),
			});
		} catch (error) {
			await fs.rm(path.join(directory, `${id}.jsonl`), { force: true });
			throw error;
		}
	}

	getWorkspace(id: string): Workspace {
		const workspace = this.repository.getWorkspace(id);
		if (!workspace) throw workspaceNotFoundError(id);
		return workspace;
	}

	listWorkspaces(): Workspace[] {
		return this.repository.listWorkspaces();
	}

	async isWorkspaceAvailable(workspaceId: string): Promise<boolean> {
		const workspace = this.getWorkspace(workspaceId);
		try {
			const location = await resolveWorkspaceLocation(workspace.path, workspace.displayName);
			return location.canonicalPath === workspace.canonicalPath;
		} catch {
			return false;
		}
	}

	getSession(id: string): CodingSession {
		const session = this.repository.getSession(id);
		if (!session) throw sessionNotFoundError(id);
		return session;
	}

	listSessions(input?: { readonly limit?: number; readonly cursor?: SessionListCursor }): SessionListPage {
		return this.repository.listSessions(input);
	}

	renameSession(id: string, title: string): CodingSession {
		return this.repository.renameSession(id, normalizeManualTitle(title), this.#now());
	}

	markTitleGenerationAttempted(id: string): CodingSession {
		return this.repository.markTitleGenerationAttempted(id, this.#now());
	}

	setGeneratedTitle(id: string, title: string): CodingSession {
		return this.repository.setGeneratedTitle(id, normalizeGeneratedTitle(title), this.#now());
	}

	touchSession(id: string): CodingSession {
		return this.repository.touchSession(id, this.#now());
	}

	listWorkspaceHistory(sessionId: string): SessionWorkspaceHistory[] {
		return this.repository.listWorkspaceHistory(sessionId);
	}

	async loadSessionSnapshot<TAppState extends JsonObject = JsonObject>(
		sessionId: string,
	): Promise<SessionSnapshot<TAppState>> {
		const session = await this.repairSessionLocation(sessionId);
		const store = new FileSessionStore<TAppState>(this.sessionDirectory(session.workspaceId));
		const stored = await store.load(sessionId);
		if (!stored) throw sessionFileMissingError(sessionId);
		return stored.snapshot;
	}

	async moveSession(input: MoveSessionInput): Promise<CodingSession> {
		const session = this.getSession(input.sessionId);
		if (input.toWorkspaceId !== null && !this.repository.getWorkspace(input.toWorkspaceId)) {
			throw workspaceNotFoundError(input.toWorkspaceId);
		}
		if (session.workspaceId === input.toWorkspaceId) return session;

		const source = await this.locateSessionFile(session);
		const destination = this.sessionFilePath(input.sessionId, input.toWorkspaceId);
		await fs.mkdir(path.dirname(destination), { recursive: true });
		if (await exists(destination)) throw sessionFileConflictError(input.sessionId);

		return withSessionLock(source, input.sessionId, async () => {
			await fs.rename(source, destination);
			try {
				return this.repository.moveSession(input.sessionId, input.toWorkspaceId, this.#now());
			} catch (error) {
				try {
					await fs.rename(destination, source);
				} catch (rollbackError) {
					throw storageInconsistentError(input.sessionId, {
						operationError: error,
						rollbackError,
					});
				}
				throw error;
			}
		});
	}

	async repairSessionLocation(sessionId: string): Promise<CodingSession> {
		const session = this.getSession(sessionId);
		const expected = this.sessionFilePath(session.id, session.workspaceId);
		if (await exists(expected)) return session;

		const matches = await this.#findSessionFiles(sessionId);
		if (matches.length === 0) throw sessionFileMissingError(sessionId);
		if (matches.length > 1) throw storageInconsistentError(sessionId);
		const actualWorkspaceId = workspaceIdFromSessionPath(this.dataRoot, matches[0]!);
		if (actualWorkspaceId !== null && !this.repository.getWorkspace(actualWorkspaceId)) {
			throw storageInconsistentError(sessionId);
		}
		return this.repository.moveSession(sessionId, actualWorkspaceId, this.#now());
	}

	async resolveExecutionContext(sessionId: string): Promise<CodingExecutionContext> {
		const session = this.getSession(sessionId);
		if (session.workspaceId === null) return { localFileAccess: false };
		const workspace = this.getWorkspace(session.workspaceId);
		if (!(await this.isWorkspaceAvailable(workspace.id))) return { localFileAccess: false };
		return {
			localFileAccess: true,
			cwd: workspace.canonicalPath,
			configRoot: workspace.canonicalPath,
			defaultAllowedDirectories: [workspace.canonicalPath],
		};
	}

	sessionDirectory(workspaceId: string | null): string {
		return path.join(this.dataRoot, workspaceId ?? UNASSIGNED_DIRECTORY, "sessions");
	}

	sessionFilePath(sessionId: string, workspaceId: string | null): string {
		return path.join(this.sessionDirectory(workspaceId), `${sessionId}.jsonl`);
	}

	close(): void {
		this.repository.close();
	}

	async locateSessionFile(session: CodingSession): Promise<string> {
		const expected = this.sessionFilePath(session.id, session.workspaceId);
		if (await exists(expected)) return expected;
		const matches = await this.#findSessionFiles(session.id);
		if (matches.length === 0) throw sessionFileMissingError(session.id);
		if (matches.length > 1) throw storageInconsistentError(session.id);
		return matches[0]!;
	}

	async #findSessionFiles(sessionId: string): Promise<string[]> {
		const entries = await fs.readdir(this.dataRoot, { withFileTypes: true }).catch((error) => {
			if (getErrorCode(error) === "ENOENT") return [];
			throw error;
		});
		const candidates = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(this.dataRoot, entry.name, "sessions", `${sessionId}.jsonl`));
		const matches = await Promise.all(
			candidates.map(async (candidate) => ((await exists(candidate)) ? candidate : undefined)),
		);
		return matches.filter((candidate): candidate is string => candidate !== undefined);
	}
}

async function resolveWorkspaceLocation(
	inputPath: string,
	displayName?: string,
): Promise<{ readonly displayName: string; readonly path: string; readonly canonicalPath: string }> {
	const absolutePath = path.resolve(inputPath);
	try {
		const [canonicalPath, stat] = await Promise.all([fs.realpath(absolutePath), fs.stat(absolutePath)]);
		if (!stat.isDirectory()) throw workspacePathInvalidError(absolutePath);
		return {
			displayName: displayName?.trim() || path.basename(absolutePath),
			path: absolutePath,
			canonicalPath,
		};
	} catch (error) {
		if (getErrorCode(error) === "coding_business.workspace_path_invalid") throw error;
		throw workspacePathInvalidError(absolutePath, error);
	}
}

function fallbackTitle(firstMessage: string): string {
	const normalized = firstMessage.replace(/\s+/g, " ").trim();
	if (!normalized) return "New session";
	return truncateCodePoints(normalized, 80);
}

function normalizeManualTitle(title: string): string {
	const normalized = title.replace(/\s+/g, " ").trim();
	return normalized || "New session";
}

function normalizeGeneratedTitle(title: string): string {
	const normalized = title.replace(/\s+/g, " ").trim();
	return truncateCodePoints(normalized || "New session", 80);
}

function truncateCodePoints(value: string, maxLength: number): string {
	const points = [...value];
	return points.length <= maxLength ? value : `${points.slice(0, maxLength - 1).join("")}…`;
}

async function withSessionLock<T>(sessionFile: string, sessionId: string, operation: () => Promise<T>): Promise<T> {
	const lockPath = `${sessionFile}.lock`;
	await acquireLock(lockPath, sessionId);
	try {
		return await operation();
	} finally {
		await fs.rm(lockPath, { force: true });
	}
}

async function acquireLock(lockPath: string, sessionId: string, reclaimed = false): Promise<void> {
	try {
		const handle = await fs.open(lockPath, "wx");
		await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), createdAt: Date.now() }));
		await handle.close();
		return;
	} catch (error) {
		if (getErrorCode(error) !== "EEXIST") throw error;
	}
	if (reclaimed || !(await isStaleLock(lockPath))) throw sessionBusyError(sessionId);
	await fs.rm(lockPath, { force: true });
	await acquireLock(lockPath, sessionId, true);
}

async function isStaleLock(lockPath: string): Promise<boolean> {
	const raw = await fs.readFile(lockPath, "utf8").catch((error) => {
		if (getErrorCode(error) === "ENOENT") return undefined;
		throw error;
	});
	if (raw === undefined) return true;
	const owner = parseLock(raw);
	if (!owner || owner.host !== hostname() || typeof owner.pid !== "number") return false;
	try {
		process.kill(owner.pid, 0);
		return false;
	} catch (error) {
		return getErrorCode(error) === "ESRCH";
	}
}

function parseLock(raw: string): { readonly pid?: unknown; readonly host?: unknown } | undefined {
	try {
		const value: unknown = JSON.parse(raw);
		return typeof value === "object" && value !== null ? (value as { pid?: unknown; host?: unknown }) : undefined;
	} catch {
		return undefined;
	}
}

async function exists(target: string): Promise<boolean> {
	return fs
		.stat(target)
		.then(() => true)
		.catch((error) => {
			if (getErrorCode(error) === "ENOENT") return false;
			throw error;
		});
}

function workspaceIdFromSessionPath(dataRoot: string, sessionFile: string): string | null {
	const relative = path.relative(dataRoot, sessionFile);
	const [directory] = relative.split(path.sep);
	if (!directory || directory === ".." || path.isAbsolute(relative)) {
		throw storageInconsistentError(path.basename(sessionFile, ".jsonl"));
	}
	return directory === UNASSIGNED_DIRECTORY ? null : directory;
}
