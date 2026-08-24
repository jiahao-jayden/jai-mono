import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { JsonObject, SessionStore } from "@jai/agent";
import { emptyPersistedCodingSessionState, type PersistedCodingSessionState } from "@jai/coding-agent";
import { getErrorCode } from "@jai/common";
import { projectNotFoundError, projectPathInvalidError, sessionNotFoundError } from "./errors";
import { defaultJaiHome, jaiDatabasePath } from "./layout";
import type { CodingBusinessRepository } from "./repository";
import { SqliteCodingBusinessRepository } from "./sqlite-repository";
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
} from "./types";

export interface CodingBusinessServiceOptions {
	readonly dataRoot?: string;
	readonly now?: () => number;
	readonly createId?: () => string;
}

/**
 * Desktop's single durable-data module. Both its metadata and the generic Agent
 * journal live in the one SQLite database behind the supplied SessionStore.
 */
export class CodingBusinessService {
	readonly repository: CodingBusinessRepository;
	readonly dataRoot: string;
	readonly #now: () => number;
	readonly #createId: () => string;
	readonly #sessionStore: SessionStore<PersistedCodingSessionState<JsonObject>>;

	constructor(
		repository: CodingBusinessRepository,
		sessionStore: SessionStore<PersistedCodingSessionState<JsonObject>>,
		options: CodingBusinessServiceOptions = {},
	) {
		this.repository = repository;
		this.dataRoot = path.resolve(options.dataRoot ?? defaultJaiHome());
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? randomUUID;
		this.#sessionStore = sessionStore;
	}

	static async open(options: CodingBusinessServiceOptions = {}): Promise<CodingBusinessService> {
		const dataRoot = path.resolve(options.dataRoot ?? defaultJaiHome());
		const repository = await SqliteCodingBusinessRepository.open(jaiDatabasePath(dataRoot));
		return new CodingBusinessService(repository, repository.createSessionStore<PersistedCodingSessionState<JsonObject>>(), {
			...options,
			dataRoot,
		});
	}

	async createProject(input: CreateProjectInput): Promise<Project> {
		const location = await resolveProjectLocation(input.path, input.displayName);
		return this.repository.createProject({ id: this.#createId(), ...location, now: this.#now() });
	}

	async relinkProject(projectId: string, input: CreateProjectInput): Promise<Project> {
		this.getProject(projectId);
		const location = await resolveProjectLocation(input.path, input.displayName);
		return this.repository.relinkProject(projectId, { ...location, now: this.#now() });
	}

	getProviderModelInventory(profileId: string): ProviderModelInventory | undefined {
		return this.repository.getProviderModelInventory(profileId);
	}

	replaceProviderModelInventory(profileId: string, modelIds: readonly string[]): ProviderModelInventory {
		return this.repository.replaceProviderModelInventory({ profileId, modelIds, fetchedAt: this.#now() });
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
		if (projectId !== null && !this.repository.getProject(projectId)) throw projectNotFoundError(projectId);
		const id = this.#createId();
		const appState = {
			...emptyPersistedCodingSessionState<TAppState>(),
			appState: input.appState ?? ({} as TAppState),
		} satisfies PersistedCodingSessionState<TAppState>;
		await this.#sessionStore.create(id, appState);
		try {
			return this.repository.createSession({ id, projectId, title: fallbackTitle(input.firstMessage) });
		} catch (error) {
			await this.#sessionStore.delete(id);
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
		this.getSession(id);
		await this.#sessionStore.delete(id);
	}

	renameSession(id: string, title: string): CodingSession {
		this.getSession(id);
		return this.repository.renameSession(id, normalizeManualTitle(title));
	}

	markTitleGenerationAttempted(id: string): CodingSession {
		this.getSession(id);
		return this.repository.markTitleGenerationAttempted(id, this.#now());
	}

	setGeneratedTitle(id: string, title: string): CodingSession {
		this.getSession(id);
		return this.repository.setGeneratedTitle(id, normalizeGeneratedTitle(title));
	}

	shouldGenerateSessionTitle(id: string): boolean {
		this.getSession(id);
		return this.repository.shouldGenerateSessionTitle(id);
	}

	async loadSessionSnapshot(
		sessionId: string,
	): Promise<CodingSessionSnapshot<PersistedCodingSessionState<JsonObject>>> {
		this.getSession(sessionId);
		const stored = await this.#sessionStore.load(sessionId);
		if (!stored) throw sessionNotFoundError(sessionId);
		return stored.snapshot;
	}

	async moveSession(input: MoveSessionInput): Promise<CodingSession> {
		const session = this.getSession(input.sessionId);
		if (input.toProjectId !== null && !this.repository.getProject(input.toProjectId)) {
			throw projectNotFoundError(input.toProjectId);
		}
		if (session.projectId === input.toProjectId) return session;
		return this.repository.moveSession(input.sessionId, input.toProjectId);
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

	get sessionStore(): SessionStore<PersistedCodingSessionState<JsonObject>> {
		return this.#sessionStore;
	}

	close(): void {
		const store = this.#sessionStore as SessionStore<PersistedCodingSessionState<JsonObject>> & { close?: () => void };
		store.close?.();
		this.repository.close();
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
	return normalized ? truncateCodePoints(normalized, 80) : "New session";
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
