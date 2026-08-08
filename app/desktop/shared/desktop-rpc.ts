import { type Static, Type } from "@sinclair/typebox";
import type {
	CodingSession,
	MoveSessionInput,
	SessionListCursor,
	SessionListPage,
	Project,
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
		_tag: Type.String({ minLength: 1 }),
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
export interface DesktopProject extends Project {
	readonly available: boolean;
}

export type DesktopProviderAdapter = "anthropic" | "openai-compatible" | "openai-responses";
export type DesktopProviderAuthentication = "api-key" | "none";
export type DesktopModelModality = "text" | "image" | "audio" | "video" | "pdf";
export type DesktopModelSource = "catalog" | "unverified";

export interface DesktopModelCost {
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly reasoning?: number;
}

export interface DesktopModelCompatibility {
	readonly maxTokensField?: "max_tokens" | "max_completion_tokens";
	readonly supportsUsageInStreaming?: boolean;
	readonly supportsStrictTools?: boolean;
	readonly reasoningFormat?: "openai" | "deepseek" | "none";
	readonly supportsThinking?: boolean;
}

export interface DesktopProviderModel {
	readonly id: string;
	readonly name: string;
	readonly remoteModelId: string;
	readonly source: DesktopModelSource;
	readonly verified: boolean;
	readonly enabled: boolean;
	readonly metadataProvider?: string;
	readonly description?: string;
	readonly family?: string;
	readonly status?: string;
	readonly releaseDate?: string;
	readonly lastUpdated?: string;
	readonly knowledge?: string;
	readonly openWeights?: boolean;
	readonly reasoning?: boolean;
	readonly reasoningOptions?: readonly string[];
	readonly temperature?: boolean;
	readonly attachment?: boolean;
	readonly interleaved?: boolean;
	readonly input?: readonly ("text" | "image")[];
	readonly inputModalities?: readonly DesktopModelModality[];
	readonly outputModalities?: readonly DesktopModelModality[];
	readonly toolCall?: boolean;
	readonly structuredOutput?: boolean;
	readonly cost?: DesktopModelCost;
	readonly contextWindow?: number;
	readonly inputLimit?: number;
	readonly maxTokens?: number;
	readonly compatibility?: DesktopModelCompatibility;
}

export function isDesktopProviderModelRunnable(model: DesktopProviderModel): boolean {
	return Boolean(
		model.verified &&
			model.inputModalities?.includes("text") &&
			model.outputModalities?.includes("text") &&
			model.toolCall === true &&
			model.contextWindow &&
			model.maxTokens,
	);
}

export interface DesktopProviderProfile {
	readonly id: string;
	readonly name: string;
	readonly adapter: DesktopProviderAdapter;
	readonly baseURL: string;
	readonly authentication: DesktopProviderAuthentication;
	readonly credentialConfigured: boolean;
	readonly credentialMask?: string;
	readonly modelsFetchedAt?: number;
	readonly models: readonly DesktopProviderModel[];
}

export interface DesktopProviderPreset {
	readonly id: string;
	readonly name: string;
	readonly adapter: DesktopProviderAdapter;
	readonly catalogProvider: string;
	readonly baseURL: string;
	readonly authentication: "api-key";
}

export interface DesktopProviderConfigSnapshot {
	readonly revision: string | null;
	readonly language?: string;
	readonly maxIterations?: number;
	readonly reasoningEffort?: "low" | "medium" | "high";
	readonly providerPresets: readonly DesktopProviderPreset[];
	readonly profiles: readonly DesktopProviderProfile[];
	readonly connector: DesktopConnectorConfigSnapshot;
}

export interface DesktopConnectorCredential {
	readonly key: string;
	readonly configured: boolean;
	readonly mask?: string;
}

export interface DesktopConnectorProvider {
	readonly id: string;
	readonly name: string;
	readonly authTypes: readonly string[];
	readonly enabled: boolean;
	readonly defaultConnection: string;
	readonly credentials: readonly DesktopConnectorCredential[];
}

export interface DesktopConnectorConfigSnapshot {
	readonly enabled: boolean;
	readonly providers: readonly DesktopConnectorProvider[];
}

export interface DesktopConnectorProviderInput {
	readonly id: string;
	readonly enabled: boolean;
	readonly defaultConnection: string;
	readonly credentials: Readonly<Record<string, string>>;
}

export interface DesktopConnectorConfigInput {
	readonly enabled: boolean;
	readonly providers: readonly DesktopConnectorProviderInput[];
}

export interface DesktopProviderProfileInput {
	readonly id: string;
	/** Original persisted profile ID when this save renames a profile. */
	readonly previousId?: string;
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
	readonly language?: string;
	readonly maxIterations?: number;
	readonly reasoningEffort?: "low" | "medium" | "high";
	readonly profiles: readonly DesktopProviderProfileInput[];
	readonly connector?: DesktopConnectorConfigInput;
}

export interface DesktopProviderFetchModelsResult {
	readonly profileId: string;
	readonly modelCount: number;
	readonly fetchedAt: number;
	readonly snapshot: DesktopProviderConfigSnapshot;
}

export interface DesktopProviderApiKeyRevealResult {
	readonly profileId: string;
	readonly apiKey: string;
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

export interface DesktopThinkingItem {
	readonly kind: "thinking";
	readonly id: string;
	readonly turnId: string;
	readonly text: string;
	readonly status: "streaming" | "complete";
	readonly timestamp: number;
}

export interface DesktopNarrationItem {
	readonly kind: "narration";
	readonly id: string;
	readonly turnId: string;
	readonly text: string;
	readonly status: "streaming" | "complete";
	readonly timestamp: number;
}

export interface DesktopToolItem {
	readonly kind: "tool";
	readonly id: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly status: "running" | "complete" | "error";
	readonly summary?: string;
	readonly details?: string;
}

export interface DesktopSubagentItem {
	readonly kind: "subagent";
	readonly id: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly title: string;
	readonly status: "running" | "complete" | "error";
	readonly activityTitle?: string;
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
	| DesktopThinkingItem
	| DesktopNarrationItem
	| DesktopToolItem
	| DesktopSubagentItem
	| DesktopPermissionItem
	| DesktopCompactionItem;

export type DesktopTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface DesktopTodoItem {
	readonly id: string;
	readonly content: string;
	readonly status: DesktopTodoStatus;
}

export interface DesktopTodos {
	readonly version: 1;
	readonly updatedAt: number;
	readonly items: readonly DesktopTodoItem[];
}

export interface DesktopAgentSnapshot {
	readonly sessionId: string;
	readonly status: DesktopAgentStatus;
	readonly items: readonly DesktopTranscriptItem[];
	readonly todos?: DesktopTodos;
	readonly lastSeq: number;
}

export type DesktopAgentEvent =
	| { readonly type: "status"; readonly status: DesktopAgentStatus }
	| { readonly type: "transcript_upsert"; readonly item: DesktopTranscriptItem }
	| { readonly type: "todos_replace"; readonly todos: DesktopTodos }
	| { readonly type: "model_catalog_updated" }
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

export type DesktopAgentMode = "manual" | "automate" | "plan";

export interface DesktopAgentMessageInput extends DesktopAgentSessionInput {
	readonly message: string;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
}

export interface DesktopSessionCreateInput {
	readonly projectId?: string | null;
	readonly firstMessage: string;
}

export interface DesktopSessionRenameInput {
	readonly sessionId: string;
	readonly title: string;
}

export interface DesktopSessionDeleteInput {
	readonly sessionId: string;
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
		fetchModels(profileId: string): Promise<DesktopProviderFetchModelsResult>;
		revealApiKey(profileId: string): Promise<DesktopProviderApiKeyRevealResult>;
	};
	readonly project: {
		list(): Promise<DesktopProject[]>;
		choose(): Promise<DesktopProject | null>;
		relink(projectId: string): Promise<DesktopProject | null>;
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
		delete(input: DesktopSessionDeleteInput): Promise<void>;
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
	| { readonly status: "ok"; readonly value?: Static<typeof jsonValueSchema> }
	| { readonly status: "error"; readonly error: Static<typeof errorEnvelopeSchema> };

export interface DesktopBridge {
	readonly platform: {
		readonly isMac: boolean;
	};
	invoke(request: DesktopRpcRequest): Promise<DesktopRpcResponse>;
	onAgentEvent(listener: (event: DesktopAgentEventEnvelope) => void): () => void;
}
