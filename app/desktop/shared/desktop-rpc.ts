import { type Static, Type } from "@sinclair/typebox";
import type {
	CodingSession,
	MoveSessionInput,
	SessionListCursor,
	SessionListPage,
	Workspace,
} from "@jai/coding/business";
import type { PermissionRequest, PermissionResolution } from "@jai/coding/permissions/approval";

export const DESKTOP_RPC_CHANNEL = "desktop:rpc";
export const DESKTOP_EVENTS_CHANNEL = "desktop:events";

export const jsonValueSchema = Type.Recursive((This) =>
	Type.Union([
		Type.Null(),
		Type.Boolean(),
		Type.Number(),
		Type.String(),
		Type.Array(This),
		Type.Record(Type.String(), This),
	]),
);

const errorEnvelopeSchema = Type.Object(
	{
		code: Type.String({ minLength: 1 }),
		message: Type.String(),
		data: Type.Optional(jsonValueSchema),
	},
	{ additionalProperties: false },
);

export const desktopRpcRequestSchema = Type.Object(
	{
		path: Type.String({ minLength: 1 }),
		args: Type.Array(jsonValueSchema),
	},
	{ additionalProperties: false },
);

export type DesktopTheme = "light" | "dark" | "system";

export type DesktopAgentStatus = "idle" | "running";
export interface DesktopWorkspace extends Workspace {
	readonly available: boolean;
}

export type DesktopProviderAdapter = "anthropic" | "openai-compatible";
export type DesktopProviderAuthentication = "api-key" | "none";

export interface DesktopProviderModel {
	readonly id: string;
	readonly name: string;
	readonly remoteModelId: string;
}

export interface DesktopProviderProfile {
	readonly id: string;
	readonly name: string;
	readonly adapter: DesktopProviderAdapter;
	readonly baseURL: string;
	readonly authentication: DesktopProviderAuthentication;
	readonly credentialConfigured: boolean;
	readonly credentialMask?: string;
	readonly models: readonly DesktopProviderModel[];
}

export interface DesktopProviderConfigSnapshot {
	readonly revision: string | null;
	readonly activeModelRef?: string;
	readonly profiles: readonly DesktopProviderProfile[];
}

export interface DesktopProviderProfileInput {
	readonly id: string;
	readonly name: string;
	readonly adapter: DesktopProviderAdapter;
	readonly baseURL: string;
	readonly authentication: DesktopProviderAuthentication;
	readonly apiKey?: string;
	readonly clearApiKey?: boolean;
	readonly models: readonly DesktopProviderModel[];
}

export interface DesktopProviderConfigInput {
	readonly revision: string | null;
	readonly activeModelRef?: string;
	readonly profiles: readonly DesktopProviderProfileInput[];
}

export interface DesktopSlashInvocation {
	readonly name: string;
	readonly kind: "skill" | "command";
	readonly displayName: string;
}

export interface DesktopMessageItem {
	readonly kind: "message";
	readonly id: string;
	readonly role: "user" | "assistant" | "toolResult";
	readonly text: string;
	readonly status: "streaming" | "complete";
	readonly timestamp: number;
	readonly stopReason?: string;
	readonly slashInvocation?: DesktopSlashInvocation;
}

export interface DesktopToolItem {
	readonly kind: "tool";
	readonly id: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly status: "running" | "complete" | "error";
	readonly summary?: string;
}

export interface DesktopPermissionItem {
	readonly kind: "permission";
	readonly id: string;
	readonly request: PermissionRequest;
	readonly status: "pending" | "allowed" | "denied" | "cancelled";
}

export interface DesktopCompactionItem {
	readonly kind: "compaction";
	readonly id: string;
	readonly summary: string;
	readonly timestamp: number;
}

export type DesktopTranscriptItem =
	| DesktopMessageItem
	| DesktopToolItem
	| DesktopPermissionItem
	| DesktopCompactionItem;

export interface DesktopAgentSnapshot {
	readonly sessionId: string;
	readonly status: DesktopAgentStatus;
	readonly items: readonly DesktopTranscriptItem[];
	readonly lastSeq: number;
}

export type DesktopAgentEvent =
	| { readonly type: "status"; readonly status: DesktopAgentStatus }
	| { readonly type: "transcript_upsert"; readonly item: DesktopTranscriptItem }
	| {
			readonly type: "runtime_error";
			readonly error: { readonly code: string; readonly message: string; readonly data?: Static<typeof jsonValueSchema> };
	  };

export interface DesktopAgentEventEnvelope {
	readonly sessionId: string;
	readonly seq: number;
	readonly event: DesktopAgentEvent;
}

export const desktopAgentEventEnvelopeSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		seq: Type.Integer({ minimum: 1 }),
		event: jsonValueSchema,
	},
	{ additionalProperties: false },
);

export interface DesktopAgentSessionInput {
	readonly sessionId: string;
}

export interface DesktopAgentMessageInput extends DesktopAgentSessionInput {
	readonly message: string;
}

export interface DesktopSessionCreateInput {
	readonly workspaceId?: string | null;
	readonly firstMessage: string;
}

export interface DesktopSessionRenameInput {
	readonly sessionId: string;
	readonly title: string;
}

export interface DesktopSessionListPage extends SessionListPage {
	readonly runningSessionIds: readonly string[];
}

export interface DesktopApi {
	readonly window: {
		close(): void;
		minimize(): void;
		fullscreen(): void;
	};
	readonly theme: {
		get(): DesktopTheme;
		set(theme: DesktopTheme): void;
	};
	readonly provider: {
		get(): Promise<DesktopProviderConfigSnapshot>;
		save(input: DesktopProviderConfigInput): Promise<DesktopProviderConfigSnapshot>;
	};
	readonly workspace: {
		list(): Promise<DesktopWorkspace[]>;
		choose(): Promise<DesktopWorkspace | null>;
		relink(workspaceId: string): Promise<DesktopWorkspace | null>;
	};
	readonly session: {
		create(input: DesktopSessionCreateInput): Promise<CodingSession>;
		get(sessionId: string): CodingSession;
		list(input?: {
			readonly limit?: number;
			readonly cursor?: SessionListCursor;
		}): DesktopSessionListPage;
		rename(input: DesktopSessionRenameInput): CodingSession;
		move(input: MoveSessionInput): Promise<CodingSession>;
	};
	readonly agent: {
		send(input: DesktopAgentMessageInput): Promise<{ readonly accepted: true }>;
		abort(sessionId: string): void;
		steer(input: DesktopAgentMessageInput): void;
		followUp(input: DesktopAgentMessageInput): void;
		resolvePermission(resolution: PermissionResolution): void;
		getSnapshot(sessionId: string): Promise<DesktopAgentSnapshot>;
		close(sessionId: string): void;
	};
}

export type AsyncRpcClient<T> = {
	[K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
		? (...args: TArgs) => Promise<Awaited<TResult>>
		: AsyncRpcClient<T[K]>;
};

export type DesktopRpcRequest = Static<typeof desktopRpcRequestSchema>;
export type DesktopRpcResponse =
	| { readonly ok: true; readonly value?: Static<typeof jsonValueSchema> }
	| { readonly ok: false; readonly error: Static<typeof errorEnvelopeSchema> };

export interface DesktopBridge {
	readonly platform: {
		readonly isMac: boolean;
	};
	invoke(request: DesktopRpcRequest): Promise<DesktopRpcResponse>;
	onAgentEvent(listener: (event: DesktopAgentEventEnvelope) => void): () => void;
}
