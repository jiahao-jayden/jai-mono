import type {
	CodingSession,
	Project,
	ProviderModelInventory,
	SessionListCursor,
	SessionListPage,
	SessionProjectHistory,
} from "./types";

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
	readonly now: number;
}

export interface CodingBusinessRepository {
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
	deleteSession(id: string): void;
	getSession(id: string): CodingSession | undefined;
	listSessions(input?: { readonly limit?: number; readonly cursor?: SessionListCursor }): SessionListPage;
	renameSession(id: string, title: string, now: number): CodingSession;
	markTitleGenerationAttempted(id: string, now: number): CodingSession;
	setGeneratedTitle(id: string, title: string, now: number): CodingSession;
	touchSession(id: string, now: number): CodingSession;
	moveSession(id: string, toProjectId: string | null, now: number): CodingSession;
	listProjectHistory(sessionId: string): SessionProjectHistory[];

	getProviderModelInventory(profileId: string): ProviderModelInventory | undefined;
	replaceProviderModelInventory(record: ProviderModelInventory): ProviderModelInventory;
	deleteProviderModelInventory(profileId: string): void;
	renameProviderModelInventory(fromProfileId: string, toProfileId: string): void;
	close(): void;
}
