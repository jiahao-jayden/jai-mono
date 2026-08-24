export type SessionTitleSource = "fallback" | "generated" | "manual";

export interface Project {
	readonly id: string;
	readonly displayName: string;
	readonly path: string;
	readonly canonicalPath: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface CodingSession {
	readonly id: string;
	readonly projectId: string | null;
	readonly title: string;
	readonly titleSource: SessionTitleSource;
	readonly lastActivityAt: number;
}

export interface SessionListCursor {
	readonly lastActivityAt: number;
	readonly id: string;
}

export interface SessionListPage {
	readonly sessions: readonly CodingSession[];
	readonly nextCursor?: SessionListCursor;
}

export interface MoveSessionInput {
	readonly sessionId: string;
	readonly toProjectId: string | null;
}
