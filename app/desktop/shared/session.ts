export type SessionTitleSource = "fallback" | "generated" | "manual";

export interface Project {
	readonly id: string;
	readonly displayName: string;
	readonly path: string;
	readonly canonicalPath: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly expanded: boolean;
}

export interface CodingSession {
	readonly id: string;
	readonly projectId: string | null;
	readonly title: string;
	readonly titleSource: SessionTitleSource;
	readonly lastActivityAt: number;
	readonly archivedAt: number | null;
	readonly pinnedAt: number | null;
}

export interface SessionListCursor {
	/** The current list's sort timestamp; archived pages carry `archivedAt`. */
	readonly lastActivityAt: number;
	readonly id: string;
}

export interface SessionListPage {
	readonly sessions: readonly CodingSession[];
	readonly nextCursor?: SessionListCursor;
}
