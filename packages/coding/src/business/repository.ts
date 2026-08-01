import type { CodingSession, SessionListCursor, SessionListPage, SessionWorkspaceHistory, Workspace } from "./types";

export interface CreateWorkspaceRecord {
	readonly id: string;
	readonly displayName: string;
	readonly path: string;
	readonly canonicalPath: string;
	readonly now: number;
}

export interface CreateSessionRecord {
	readonly id: string;
	readonly workspaceId: string | null;
	readonly title: string;
	readonly now: number;
}

export interface CodingBusinessRepository {
	createWorkspace(record: CreateWorkspaceRecord): Workspace;
	getWorkspace(id: string): Workspace | undefined;
	findWorkspaceByCanonicalPath(canonicalPath: string): Workspace | undefined;
	listWorkspaces(): Workspace[];
	relinkWorkspace(
		id: string,
		location: {
			readonly displayName: string;
			readonly path: string;
			readonly canonicalPath: string;
			readonly now: number;
		},
	): Workspace;

	createSession(record: CreateSessionRecord): CodingSession;
	deleteSession(id: string): void;
	getSession(id: string): CodingSession | undefined;
	listSessions(input?: { readonly limit?: number; readonly cursor?: SessionListCursor }): SessionListPage;
	renameSession(id: string, title: string, now: number): CodingSession;
	markTitleGenerationAttempted(id: string, now: number): CodingSession;
	setGeneratedTitle(id: string, title: string, now: number): CodingSession;
	touchSession(id: string, now: number): CodingSession;
	moveSession(id: string, toWorkspaceId: string | null, now: number): CodingSession;
	listWorkspaceHistory(sessionId: string): SessionWorkspaceHistory[];
	close(): void;
}
