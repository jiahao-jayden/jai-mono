export type {
	DesktopSessionCatalogRepository,
	CreateProjectRecord,
	CreateSessionRecord,
} from "./repository";
export { DesktopSessionCatalog, type DesktopSessionCatalogOptions } from "./catalog";
export { SqliteDesktopSessionCatalogRepository } from "./sqlite-catalog-repository";
export { defaultJaiHome, jaiDatabasePath } from "./layout";
export type {
	CodingExecutionContext,
	CodingSession,
	CodingSessionEntry,
	CodingSessionSnapshot,
	CreateProjectInput,
	CreateSessionInput,
	MoveSessionInput,
	Project,
	SessionListCursor,
	SessionListPage,
	SessionTitleSource,
} from "./types";
