import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonObject } from "@jai/agent";
import { connectDesktopCatalogClient, type DesktopCatalogClient } from "@jai/server/desktop-catalog-client";
import { connectJaiRuntimeHost, resolveJaiDataDirectory } from "@jai/server/acp-client";
import { Result, TaggedError } from "better-result";
import {
	projectNotFoundError,
	projectPathInvalidError,
	sessionNotFoundError,
	} from "./errors";
import type {
	CodingExecutionContext,
	CodingSession,
	CreateProjectInput,
	CreateSessionInput,
	MoveSessionInput,
	Project,
	SessionListCursor,
	SessionListPage,
} from "./types";

export interface DesktopSessionCatalogPort {
	createProject(input: CreateProjectInput): Promise<Project>;
	relinkProject(projectId: string, input: CreateProjectInput): Promise<Project>;
	createSession<TAppState extends JsonObject = JsonObject>(input: CreateSessionInput<TAppState>): Promise<CodingSession>;
	getProject(id: string): Promise<Project>;
	listProjects(): Promise<readonly Project[]>;
	isProjectAvailable(projectId: string): Promise<boolean>;
	getSession(id: string): Promise<CodingSession>;
	listSessions(input?: { readonly limit?: number; readonly cursor?: SessionListCursor }): Promise<SessionListPage>;
	deleteSession(id: string): Promise<void>;
	renameSession(id: string, title: string): Promise<CodingSession>;
	markTitleGenerationAttempted(id: string): Promise<CodingSession>;
	setGeneratedTitle(id: string, title: string): Promise<CodingSession>;
	shouldGenerateSessionTitle(id: string): Promise<boolean>;
	moveSession(input: MoveSessionInput): Promise<CodingSession>;
	resolveExecutionContext(sessionId: string): Promise<CodingExecutionContext>;
	close(): Promise<void>;
}

/** The two Host-mediated capabilities the Catalog needs; neither exposes SQLite. */
export interface RemoteDesktopSessionCatalogTransport {
	readonly catalog: DesktopCatalogClient;
	createSessionJournal(input: { readonly sessionId: string; readonly cwd: string }): Promise<void>;
}

class DesktopRemoteCatalogFailed extends TaggedError("desktop_session_catalog.remote_failed")<{
	readonly method: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/**
 * Desktop Catalog product semantics with all durable I/O delegated to the
 * Runtime Host's private control channel. This adapter never imports SQLite or
 * a SessionStore.
 */
export class RemoteDesktopSessionCatalog implements DesktopSessionCatalogPort {
	readonly #transport: RemoteDesktopSessionCatalogTransport;
	readonly #projects = new Map<string, Project>();
	readonly #now: () => number;
	readonly #createId: () => string;

	constructor(
		transport: RemoteDesktopSessionCatalogTransport,
		options: { readonly now?: () => number; readonly createId?: () => string } = {},
	) {
		this.#transport = transport;
		this.#now = options.now ?? Date.now;
		this.#createId = options.createId ?? randomUUID;
	}

	static async open(options: {
		readonly dataDirectory?: string;
		readonly environment?: Readonly<Record<string, string | undefined>>;
		readonly endpoint?: string;
	} = {}): Promise<RemoteDesktopSessionCatalog> {
		const dataDirectory = path.resolve(options.dataDirectory ?? resolveJaiDataDirectory(options.environment));
		const connected = await connectDesktopCatalogClient({
			dataDirectory,
			...(options.environment === undefined ? {} : { environment: options.environment }),
			...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
		});
		if (connected.isErr()) {
			throw new DesktopRemoteCatalogFailed({ method: "connect", message: "Desktop could not connect to Runtime Host Catalog", cause: connected.error });
		}
		const catalog = new RemoteDesktopSessionCatalog({
			catalog: connected.value,
			createSessionJournal: ({ sessionId, cwd }) => createSessionJournal(dataDirectory, sessionId, cwd),
		});
		await catalog.#refreshProjects();
		return catalog;
	}

	async createProject(input: CreateProjectInput): Promise<Project> {
		const location = await resolveProjectLocation(input.path, input.displayName);
		const now = this.#now();
		const created = await this.#transport.catalog.createProject({
			id: this.#createId(),
			displayName: location.displayName,
			path: location.path,
			canonicalPath: location.canonicalPath,
			createdAt: now,
			updatedAt: now,
		});
		const project = unwrap(created, "projects/create");
		this.#projects.set(project.id, project);
		return project;
	}

	async relinkProject(projectId: string, input: CreateProjectInput): Promise<Project> {
		await this.getProject(projectId);
		const location = await resolveProjectLocation(input.path, input.displayName);
		const now = this.#now();
		const relinked = await this.#transport.catalog.relinkProject({
			id: projectId,
			displayName: location.displayName,
			path: location.path,
			canonicalPath: location.canonicalPath,
			createdAt: this.#projects.get(projectId)?.createdAt ?? now,
			updatedAt: now,
		});
		const project = unwrap(relinked, "projects/relink");
		this.#projects.set(project.id, project);
		return project;
	}

	async createSession<TAppState extends JsonObject = JsonObject>(input: CreateSessionInput<TAppState>): Promise<CodingSession> {
		const projectId = input.projectId ?? null;
		if (projectId !== null) await this.getProject(projectId);
		const id = this.#createId();
		const title = fallbackTitle(input.firstMessage);
		await this.#createJournal(id, projectId);
		const ensured = await this.#transport.catalog.ensureSession({ sessionId: id, projectId, title });
		return unwrap(ensured, "sessions/ensure");
	}

	async getProject(id: string): Promise<Project> {
		const cached = this.#projects.get(id);
		if (cached) return cached;
		await this.#refreshProjects();
		const project = this.#projects.get(id);
		if (!project) throw projectNotFoundError(id);
		return project;
	}

	async listProjects(): Promise<readonly Project[]> {
		await this.#refreshProjects();
		return [...this.#projects.values()];
	}

	async isProjectAvailable(projectId: string): Promise<boolean> {
		const project = await this.getProject(projectId);
		try {
			const location = await resolveProjectLocation(project.path, project.displayName);
			return location.canonicalPath === project.canonicalPath;
		} catch {
			return false;
		}
	}

	async getSession(id: string): Promise<CodingSession> {
		const session = unwrap(await this.#transport.catalog.getSession(id), "sessions/get");
		if (!session) throw sessionNotFoundError(id);
		return session;
	}

	async listSessions(input?: { readonly limit?: number; readonly cursor?: SessionListCursor }): Promise<SessionListPage> {
		return unwrap(await this.#transport.catalog.listSessions(input), "sessions/list");
	}

	async deleteSession(id: string): Promise<void> {
		await this.getSession(id);
		unwrap(await this.#transport.catalog.deleteSession(id), "sessions/delete");
	}

	async renameSession(id: string, title: string): Promise<CodingSession> {
		await this.getSession(id);
		return unwrap(await this.#transport.catalog.renameSession({ sessionId: id, title: normalizeManualTitle(title) }), "sessions/rename");
	}

	async markTitleGenerationAttempted(id: string): Promise<CodingSession> {
		await this.getSession(id);
		return unwrap(
			await this.#transport.catalog.markTitleGenerationAttempted({ sessionId: id, timestamp: this.#now() }),
			"sessions/mark-title-generation-attempted",
		);
	}

	async setGeneratedTitle(id: string, title: string): Promise<CodingSession> {
		await this.getSession(id);
		return unwrap(await this.#transport.catalog.setGeneratedTitle({ sessionId: id, title: normalizeGeneratedTitle(title) }), "sessions/set-generated-title");
	}

	async shouldGenerateSessionTitle(id: string): Promise<boolean> {
		await this.getSession(id);
		return unwrap(await this.#transport.catalog.shouldGenerateSessionTitle(id), "sessions/should-generate-title");
	}

	async moveSession(input: MoveSessionInput): Promise<CodingSession> {
		await this.getSession(input.sessionId);
		if (input.toProjectId !== null) await this.getProject(input.toProjectId);
		return unwrap(await this.#transport.catalog.moveSession({ sessionId: input.sessionId, projectId: input.toProjectId }), "sessions/move");
	}

	async resolveExecutionContext(sessionId: string): Promise<CodingExecutionContext> {
		const session = await this.getSession(sessionId);
		if (session.projectId === null || !(await this.isProjectAvailable(session.projectId))) return { localFileAccess: false };
		const project = await this.getProject(session.projectId);
		return {
			localFileAccess: true,
			cwd: project.canonicalPath,
			configRoot: project.canonicalPath,
			defaultAllowedDirectories: [project.canonicalPath],
		};
	}

	async close(): Promise<void> {
		await this.#transport.catalog.close();
	}

	async #refreshProjects(): Promise<void> {
		const projects = unwrap(await this.#transport.catalog.listProjects(), "projects/list");
		this.#projects.clear();
		for (const project of projects) this.#projects.set(project.id, project);
	}

	async #createJournal(sessionId: string, projectId: string | null): Promise<void> {
		const cwd = projectId === null ? process.cwd() : (await this.getProject(projectId)).canonicalPath;
		await this.#transport.createSessionJournal({ sessionId, cwd });
	}
}

async function createSessionJournal(dataDirectory: string, sessionId: string, cwd: string): Promise<void> {
	const connected = await connectJaiRuntimeHost({ dataDirectory });
	if (connected.isErr()) throw new DesktopRemoteCatalogFailed({ method: "session/new", message: "Could not connect to Runtime Host for Session creation", cause: connected.error });
	try {
		const initialized = await connected.value.request("initialize", {
			protocolVersion: 2,
			capabilities: {},
			info: { name: "jai-desktop-catalog", version: "0.0.0" },
		});
		if (initialized.isErr()) throw new DesktopRemoteCatalogFailed({ method: "initialize", message: "Could not initialize Runtime Host", cause: initialized.error });
		const created = await connected.value.request("session/new", { sessionId, cwd });
		if (created.isErr()) throw new DesktopRemoteCatalogFailed({ method: "session/new", message: "Could not create Runtime Host Session", cause: created.error });
		const closed = await connected.value.request("session/close", { sessionId });
		if (closed.isErr()) throw new DesktopRemoteCatalogFailed({ method: "session/close", message: "Could not release temporary Session controller", cause: closed.error });
	} finally {
		await connected.value.close();
	}
}

function unwrap<T>(result: Result<T, { readonly message: string; readonly cause?: unknown }>, method: string): T {
	if (result.isOk()) return result.value;
	throw new DesktopRemoteCatalogFailed({ method, message: result.error.message, cause: result.error.cause });
}

async function resolveProjectLocation(inputPath: string, displayName?: string): Promise<{ readonly displayName: string; readonly path: string; readonly canonicalPath: string }> {
	const absolutePath = path.resolve(inputPath);
	try {
		const [canonicalPath, stat] = await Promise.all([fs.realpath(absolutePath), fs.stat(absolutePath)]);
		if (!stat.isDirectory()) throw projectPathInvalidError(absolutePath);
		return { displayName: displayName?.trim() || path.basename(absolutePath), path: absolutePath, canonicalPath };
	} catch (error) {
		if (error && typeof error === "object" && "_tag" in error && error._tag === "desktop_session_catalog.project_path_invalid") throw error;
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
	return truncateCodePoints(title.replace(/\s+/g, " ").trim() || "New session", 80);
}

function truncateCodePoints(value: string, maxLength: number): string {
	const points = [...value];
	return points.length <= maxLength ? value : `${points.slice(0, maxLength - 1).join("")}…`;
}
