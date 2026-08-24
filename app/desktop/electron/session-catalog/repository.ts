import type { CodingSession, Project, SessionListCursor, SessionListPage } from "./types";

export interface CreateProjectRecord {
	readonly id: string;
	readonly displayName: string;
	readonly path: string;
	readonly canonicalPath: string;
	readonly now: number;
}

export interface CreateSessionRecord {
	readonly id: string;
	readonly projectId: string | null;
	readonly title: string;
}

/** Desktop-owned Project and Session metadata over the generic SessionStore journal. */
export interface DesktopSessionCatalogRepository {
	createProject(record: CreateProjectRecord): Project;
	getProject(id: string): Project | undefined;
	findProjectByCanonicalPath(canonicalPath: string): Project | undefined;
	listProjects(): Project[];
	relinkProject(
		id: string,
		location: {
			readonly displayName: string;
			readonly path: string;
			readonly canonicalPath: string;
			readonly now: number;
		},
	): Project;

	createSession(record: CreateSessionRecord): CodingSession;
	getSession(id: string): CodingSession | undefined;
	listSessions(input?: { readonly limit?: number; readonly cursor?: SessionListCursor }): SessionListPage;
	renameSession(id: string, title: string): CodingSession;
	markTitleGenerationAttempted(id: string, timestamp: number): CodingSession;
	setGeneratedTitle(id: string, title: string): CodingSession;
	shouldGenerateSessionTitle(id: string): boolean;
	moveSession(id: string, toProjectId: string | null): CodingSession;
	close(): void;
}
