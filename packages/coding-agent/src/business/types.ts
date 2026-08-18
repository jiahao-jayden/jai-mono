import type { AgentMessage, JsonObject } from "@jai/agent";

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
	readonly titleGenerationAttemptedAt: number | null;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly lastActivityAt: number;
}

/** Host-facing durable session view consumed by host adapters. */
export type CodingSessionEntry<TAppState extends JsonObject = JsonObject> =
	| {
			type: "message";
			id: string;
			timestamp: string;
			message: AgentMessage;
	  }
	| {
			type: "app_state";
			id: string;
			timestamp: string;
			value: TAppState;
	  }
	| {
			type: "compaction";
			id: string;
			timestamp: string;
			summary: string;
			firstKeptEntryId: string;
			tokensBefore: number;
			tokensAfter: number;
			usage: unknown;
	  };

export interface CodingSessionSnapshot<TAppState extends JsonObject = JsonObject> {
	readonly entries: readonly CodingSessionEntry<TAppState>[];
	readonly appState: TAppState;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface SessionProjectHistory {
	readonly id: number;
	readonly sessionId: string;
	readonly fromProjectId: string | null;
	readonly toProjectId: string | null;
	readonly movedAt: number;
}

export interface SessionListCursor {
	readonly lastActivityAt: number;
	readonly id: string;
}

export interface SessionListPage {
	readonly sessions: readonly CodingSession[];
	readonly nextCursor?: SessionListCursor;
}

export interface ProviderModelInventory {
	readonly profileId: string;
	readonly modelIds: readonly string[];
	readonly fetchedAt: number;
}

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

export interface MoveSessionInput {
	readonly sessionId: string;
	readonly toProjectId: string | null;
}
