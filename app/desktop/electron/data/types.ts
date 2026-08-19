import type { AgentMessage, JsonObject } from "@jai/agent";

export type {
	CodingSession,
	MoveSessionInput,
	Project,
	SessionListCursor,
	SessionListPage,
	SessionTitleSource,
} from "../../shared/session";

export interface SessionProjectHistory {
	readonly id: number;
	readonly sessionId: string;
	readonly fromProjectId: string | null;
	readonly toProjectId: string | null;
	readonly movedAt: number;
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
