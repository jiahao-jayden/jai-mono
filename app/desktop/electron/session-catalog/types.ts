import type { JsonObject } from "@jai/agent";

export type {
	CodingSession,
	MoveSessionInput,
	Project,
	SessionListCursor,
	SessionListPage,
	SessionTitleSource,
} from "../../shared/session";

export type CodingExecutionContext =
	| {
			readonly localFileAccess: true;
			readonly cwd: string;
			readonly configRoot: string;
			readonly defaultAllowedDirectories: readonly [string, ...string[]];
	  }
	| {
			readonly localFileAccess: false;
	  };

export interface CreateProjectInput {
	readonly path: string;
	readonly displayName?: string;
}

export interface CreateSessionInput<TAppState extends JsonObject = JsonObject> {
	readonly projectId?: string | null;
	readonly firstMessage: string;
	readonly appState?: TAppState;
}

/**
 * Host adapters consume the agent's own session shape. Re-exported (not re-declared)
 * so a schema change in @jai/agent breaks compilation here instead of silently
 * disagreeing across the `as unknown as` that used to bridge the two.
 */
export type {
	SessionEntry as CodingSessionEntry,
	SessionSnapshot as CodingSessionSnapshot,
} from "@jai/agent";
