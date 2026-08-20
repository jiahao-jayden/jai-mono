import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import type { JsonObject } from "@jai/agent";
import { FileSessionStore } from "@jai/agent/node";
import { getErrorCode } from "@jai/common";
import {
	projectDirectoryConflictError,
	projectNotFoundError,
	projectPathInvalidError,
	sessionBusyError,
	sessionFileConflictError,
	sessionFileMissingError,
	sessionNotFoundError,
	storageInconsistentError,
} from "./errors";
import type { CodingBusinessRepository } from "./repository";
import type {
	CodingExecutionContext,
	CodingSession,
	CodingSessionSnapshot,
	CreateProjectInput,
	CreateSessionInput,
	MoveSessionInput,
	Project,
	ProviderModelInventory,
	SessionListCursor,
	SessionListPage,
	SessionProjectHistory,
} from "./types";
import {
	defaultDesktopDataRoot,
	desktopSessionDirectory,
	projectDirectoryName,
	UNASSIGNED_DIRECTORY,
} from "./layout";

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
		this.dataRoot = path.resolve(options.dataRoot ?? defaultDesktopDataRoot());
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? randomUUID;
	}

	static async open(options: CodingBusinessServiceOptions = {}): Promise<CodingBusinessService> {
		const dataRoot = path.resolve(options.dataRoot ?? defaultDesktopDataRoot());
		const { SqliteCodingBusinessRepository } = await import("./sqlite-repository");
		const repository = await SqliteCodingBusinessRepository.open(path.join(dataRoot, "data.sqlite"));
		return new CodingBusinessService(repository, { ...options, dataRoot });
	}

	async createProject(input: CreateProjectInput): Promise<Project> {
		const location = await resolveProjectLocation(input.path, input.displayName);
		this.assertProjectDirectoryAvailable(location.canonicalPath);
		return this.repository.createProject({
			id: this.#createId(),
			...location,
			now: this.#now(),
		});
	}

	async relinkProject(projectId: string, input: CreateProjectInput): Promise<Project> {
		this.getProject(projectId);
		const location = await resolveProjectLocation(input.path, input.displayName);
		this.assertProjectDirectoryAvailable(location.canonicalPath, projectId);

		const sourceDirectory = this.sessionDirectory(projectId);
		const destinationDirectory = path.join(this.dataRoot, projectDirectoryName(location.canonicalPath), "sessions");
		const sourceRoot = path.dirname(sourceDirectory);
		const destinationRoot = path.dirname(destinationDirectory);
		if (sourceDirectory === destinationDirectory || !(await exists(sourceDirectory))) {
			return this.repository.relinkProject(projectId, {
				...location,
				now: this.#now(),
			});
		}
		if (await exists(destinationRoot)) {
			throw projectDirectoryConflictError(path.basename(destinationRoot));
		}

		await fs.mkdir(this.dataRoot, { recursive: true });
		await fs.rename(sourceRoot, destinationRoot);
		try {
			return this.repository.relinkProject(projectId, {
				...location,
				now: this.#now(),
			});
		} catch (error) {
			await fs.rename(destinationRoot, sourceRoot);
			throw error;
		}
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
		const projectId = input.projectId ?? null;
		if (projectId !== null && !this.repository.getProject(projectId)) {
			throw projectNotFoundError(projectId);
		}
		const id = this.#createId();
		const directory = this.sessionDirectory(projectId);
		const store = new FileSessionStore<TAppState>(directory);
		await store.create(id, input.appState ?? ({} as TAppState));
		try {
			return this.repository.createSession({
				id,
				projectId,
				title: fallbackTitle(input.firstMessage),
				now: this.#now(),
			});
		} catch (error) {
			await fs.rm(path.join(directory, `${id}.jsonl`), { force: true });
			throw error;
		}
	}

	getProject(id: string): Project {
		const project = this.repository.getProject(id);
		if (!project) throw projectNotFoundError(id);
		return project;
	}

	listProjects(): Project[] {
		return this.repository.listProjects();
	}

	async isProjectAvailable(projectId: string): Promise<boolean> {
		const project = this.getProject(projectId);
		try {
			const location = await resolveProjectLocation(project.path, project.displayName);
			return location.canonicalPath === project.canonicalPath;
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

	async deleteSession(id: string): Promise<void> {
		const session = this.getSession(id);
		const source = await this.locateSessionFile(session);
		const tombstone = `${source}.deleting`;

		await withSessionLock(source, id, async () => {
			await fs.rename(source, tombstone);
			try {
				this.repository.deleteSession(id);
			} catch (error) {
				await fs.rename(tombstone, source);
				throw error;
			}
			await fs.rm(tombstone, { force: true });
		});
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

	listProjectHistory(sessionId: string): SessionProjectHistory[] {
		return this.repository.listProjectHistory(sessionId);
	}

	async loadSessionSnapshot<TAppState extends JsonObject = JsonObject>(
		sessionId: string,
	): Promise<CodingSessionSnapshot<TAppState>> {
		const session = await this.repairSessionLocation(sessionId);
		const store = new FileSessionStore<TAppState>(this.sessionDirectory(session.projectId));
		const stored = await store.load(sessionId);
		if (!stored) throw sessionFileMissingError(sessionId);
		return stored.snapshot;
	}

	async moveSession(input: MoveSessionInput): Promise<CodingSession> {
		const session = this.getSession(input.sessionId);
		if (input.toProjectId !== null && !this.repository.getProject(input.toProjectId)) {
			throw projectNotFoundError(input.toProjectId);
		}
		if (session.projectId === input.toProjectId) return session;

		const source = await this.locateSessionFile(session);
		const destination = this.sessionFilePath(input.sessionId, input.toProjectId);
		await fs.mkdir(path.dirname(destination), { recursive: true });
		if (await exists(destination)) throw sessionFileConflictError(input.sessionId);

		return withSessionLock(source, input.sessionId, async () => {
			await fs.rename(source, destination);
			try {
				return this.repository.moveSession(input.sessionId, input.toProjectId, this.#now());
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
		const expected = this.sessionFilePath(session.id, session.projectId);
		if (await exists(expected)) return session;

		const matches = await this.#findSessionFiles(sessionId);
		if (matches.length === 0) throw sessionFileMissingError(sessionId);
		if (matches.length > 1) throw storageInconsistentError(sessionId);
		const actualProjectId = this.projectIdFromSessionPath(matches[0]!);
		if (actualProjectId !== null && !this.repository.getProject(actualProjectId)) {
			throw storageInconsistentError(sessionId);
		}
		return this.repository.moveSession(sessionId, actualProjectId, this.#now());
	}

	async resolveExecutionContext(sessionId: string): Promise<CodingExecutionContext> {
		const session = this.getSession(sessionId);
		if (session.projectId === null) return { localFileAccess: false };
		const project = this.getProject(session.projectId);
		if (!(await this.isProjectAvailable(project.id))) return { localFileAccess: false };
		return {
			localFileAccess: true,
			cwd: project.canonicalPath,
			configRoot: project.canonicalPath,
			defaultAllowedDirectories: [project.canonicalPath],
		};
	}

	sessionDirectory(projectId: string | null): string {
		const canonicalPath = projectId === null ? null : this.getProject(projectId).canonicalPath;
		return desktopSessionDirectory(canonicalPath, this.dataRoot);
	}

	sessionFilePath(sessionId: string, projectId: string | null): string {
		return path.join(this.sessionDirectory(projectId), `${sessionId}.jsonl`);
	}

	close(): void {
		this.repository.close();
	}

	async locateSessionFile(session: CodingSession): Promise<string> {
		const expected = this.sessionFilePath(session.id, session.projectId);
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

	private assertProjectDirectoryAvailable(canonicalPath: string, exceptProjectId?: string): void {
		const directory = projectDirectoryName(canonicalPath);
		if (
			directory === UNASSIGNED_DIRECTORY ||
			this.repository
				.listProjects()
				.some(
					(project) => project.id !== exceptProjectId && projectDirectoryName(project.canonicalPath) === directory,
				)
		) {
			throw projectDirectoryConflictError(directory);
		}
	}

	private projectIdFromSessionPath(sessionFile: string): string | null {
		const relative = path.relative(this.dataRoot, sessionFile);
		const [directory] = relative.split(path.sep);
		if (!directory || directory === ".." || path.isAbsolute(relative)) {
			throw storageInconsistentError(path.basename(sessionFile, ".jsonl"));
		}
		if (directory === UNASSIGNED_DIRECTORY) return null;
		const matches = this.repository
			.listProjects()
			.filter((project) => projectDirectoryName(project.canonicalPath) === directory);
		if (matches.length !== 1) throw storageInconsistentError(path.basename(sessionFile, ".jsonl"));
		return matches[0]!.id;
	}
}

async function resolveProjectLocation(
	inputPath: string,
	displayName?: string,
): Promise<{ readonly displayName: string; readonly path: string; readonly canonicalPath: string }> {
	const absolutePath = path.resolve(inputPath);
	try {
		const [canonicalPath, stat] = await Promise.all([fs.realpath(absolutePath), fs.stat(absolutePath)]);
		if (!stat.isDirectory()) throw projectPathInvalidError(absolutePath);
		return {
			displayName: displayName?.trim() || path.basename(absolutePath),
			path: absolutePath,
			canonicalPath,
		};
	} catch (error) {
		if (getErrorCode(error) === "coding_business.project_path_invalid") throw error;
		throw projectPathInvalidError(absolutePath, error);
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
