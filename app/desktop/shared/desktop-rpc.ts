import { type Static, Type } from "@sinclair/typebox";
import type { ConnectorActionPermission } from "@jai/connector";
import type { CodingSession, MoveSessionInput, Project, SessionListCursor, SessionListPage } from "./session";

export type { CodingSession, MoveSessionInput, Project, SessionListCursor, SessionListPage } from "./session";

export interface DesktopPermissionRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly reason: string;
	readonly canAlwaysAllow?: boolean;
	readonly summary: {
		readonly title: string;
		readonly description?: string;
		readonly command?: string;
		readonly path?: string;
		readonly risk?: "low" | "medium" | "high";
	};
	readonly suggestedRule?: string;
	readonly rememberScope?: "session" | "project-local";
}

export const desktopPermissionResolutionSchema = Type.Object(
	{
		requestId: Type.String({ minLength: 1 }),
		decision: Type.Union([Type.Literal("deny"), Type.Literal("allowOnce"), Type.Literal("alwaysAllow")]),
	},
	{ additionalProperties: false },
);

export type DesktopToolPermissionResolution = Static<typeof desktopPermissionResolutionSchema>;

export const desktopExtensionPermissionResolutionSchema = Type.Object(
	{
		kind: Type.Literal("extension"),
		requestId: Type.String({ minLength: 1 }),
		decision: Type.Union([Type.Literal("deny"), Type.Literal("allowOnce"), Type.Literal("allow")]),
	},
	{ additionalProperties: false },
);

export type DesktopExtensionPermissionResolution = Static<typeof desktopExtensionPermissionResolutionSchema>;

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

const desktopAgentCreationFailureReasonSchema = Type.Union([
	Type.Literal("model_unavailable"),
	Type.Literal("provider_configuration_invalid"),
	Type.Literal("agent_initialization_failed"),
]);

export type DesktopAgentCreationFailureReason = Static<typeof desktopAgentCreationFailureReasonSchema>;

const errorEnvelopeSchema = Type.Object(
	{
		_tag: Type.String({ minLength: 1 }),
		message: Type.String(),
		reason: Type.Optional(desktopAgentCreationFailureReasonSchema),
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

export type DesktopArtifactFormat = "markdown" | "html";

export interface DesktopArtifact {
	readonly id: string;
	readonly toolCallId: string;
	readonly path: string;
	readonly format: DesktopArtifactFormat;
	readonly updatedAt: number;
}

export const desktopArtifactReadInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		artifactId: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

export type DesktopArtifactReadInput = Static<typeof desktopArtifactReadInputSchema>;

export interface DesktopArtifactPreview {
	readonly artifact: DesktopArtifact;
	readonly content: string;
}

export type DesktopWorkspaceEntryKind = "directory" | "file";

export interface DesktopWorkspaceEntry {
	readonly name: string;
	readonly path: string;
	readonly kind: DesktopWorkspaceEntryKind;
}

export const desktopWorkspaceListInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		path: Type.String(),
	},
	{ additionalProperties: false },
);

export type DesktopWorkspaceListInput = Static<typeof desktopWorkspaceListInputSchema>;

export interface DesktopWorkspaceListResult {
	readonly path: string;
	readonly entries: readonly DesktopWorkspaceEntry[];
}

export const desktopWorkspaceReadInputSchema = desktopWorkspaceListInputSchema;

export type DesktopWorkspaceReadInput = Static<typeof desktopWorkspaceReadInputSchema>;

export interface DesktopWorkspaceFile {
	readonly path: string;
	readonly content: string;
}

export type DesktopWorkspaceOpenTarget = "application" | "cursor" | "default";

/**
 * `applicationId` is required only when opening with a chosen application.
 *
 * The type stays a single optional-field shape so callers can build it without
 * narrowing first; the schema is what enforces the pairing at the seam.
 */
export const desktopWorkspaceOpenInputSchema = Type.Union([
	Type.Object(
		{
			sessionId: Type.String({ minLength: 1 }),
			path: Type.String(),
			target: Type.Literal("application"),
			applicationId: Type.String({ minLength: 1 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			sessionId: Type.String({ minLength: 1 }),
			path: Type.String(),
			target: Type.Union([Type.Literal("cursor"), Type.Literal("default")]),
		},
		{ additionalProperties: false },
	),
]);

export interface DesktopWorkspaceOpenInput {
	readonly sessionId: string;
	readonly path: string;
	readonly target: DesktopWorkspaceOpenTarget;
	readonly applicationId?: string;
}

export interface DesktopWorkspaceOpenApplication {
	readonly id: string;
	readonly name: string;
	readonly iconDataUrl?: string;
	readonly isDefault: boolean;
}

export interface DesktopWorkspaceOpenApplications {
	readonly applications: readonly DesktopWorkspaceOpenApplication[];
	readonly defaultApplication?: DesktopWorkspaceOpenApplication;
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
	readonly label: string;
	readonly kind: "text" | "secret" | "url";
	readonly description?: string;
	readonly placeholder?: string;
	readonly configured: boolean;
	readonly mask?: string;
}

export interface DesktopConnectorOAuthConnection {
	readonly connected: boolean;
	readonly scopes: readonly string[];
	readonly expiresAt?: number;
}

export type DesktopConnectorPermission = ConnectorActionPermission;

export interface DesktopConnectorAction {
	readonly actionId: string;
	readonly description: string;
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity: "normal" | "sensitive" | "secret";
	readonly permission: DesktopConnectorPermission;
}

export interface DesktopConnector {
	readonly id: string;
	readonly name: string;
	readonly iconUrl?: string;
	readonly description?: string;
	readonly authTypes: readonly string[];
	readonly enabled: boolean;
	readonly credentials: readonly DesktopConnectorCredential[];
	readonly actions: readonly DesktopConnectorAction[];
	readonly oauth?: DesktopConnectorOAuthConnection;
}

export interface DesktopConnectorPolicy {
	readonly default: DesktopConnectorPermission;
	readonly actions: Readonly<Record<string, DesktopConnectorPermission>>;
}

export interface DesktopConnectorConfigSnapshot {
	readonly connectors: readonly DesktopConnector[];
	readonly policy: DesktopConnectorPolicy;
}

export interface DesktopConnectorInput {
	readonly id: string;
	readonly enabled: boolean;
	readonly credentials: Readonly<Record<string, string>>;
}

export interface DesktopConnectorConfigInput {
	readonly connectors: readonly DesktopConnectorInput[];
	readonly policy: DesktopConnectorPolicy;
}

export interface DesktopConnectorOAuthStartResult {
	readonly connectorId: string;
	readonly expiresAt: number;
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

export interface DesktopMessageAttachment {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly size: number;
}

export const desktopMessageAttachmentSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		filename: Type.String(),
		mimeType: Type.String(),
		size: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const desktopAttachmentRegistrationInputSchema = Type.Object(
	{
		sourcePath: Type.String({ minLength: 1 }),
		filename: Type.String({ minLength: 1 }),
		mimeType: Type.String(),
		size: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export type DesktopAttachmentRegistrationInput = Static<typeof desktopAttachmentRegistrationInputSchema>;

export interface DesktopMessageItem {
	readonly kind: "message";
	readonly id: string;
	/** Durable ledger entry id for a message that can be used as a branch target. */
	readonly entryId?: string;
	readonly role: "user" | "assistant" | "toolResult";
	readonly text: string;
	readonly status: "streaming" | "complete";
	readonly timestamp: number;
	readonly stopReason?: string;
	readonly slashInvocation?: DesktopSlashInvocation;
	readonly attachments?: readonly DesktopMessageAttachment[];
}

export interface DesktopThinkingItem {
	readonly kind: "thinking";
	readonly id: string;
	readonly turnId: string;
	readonly activityId: string;
	readonly text: string;
	readonly status: "streaming" | "complete";
	readonly timestamp: number;
}

export interface DesktopNarrationItem {
	readonly kind: "narration";
	readonly id: string;
	readonly turnId: string;
	readonly activityId: string;
	readonly text: string;
	readonly status: "streaming" | "complete";
	readonly timestamp: number;
}

export type DesktopToolActivityKind = "search" | "read" | "write" | "execute" | "call" | "operation";

export interface DesktopToolItem {
	readonly kind: "tool";
	readonly id: string;
	readonly turnId: string;
	readonly activityId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	/** Captured at tool registration and execution, never inferred from the name in the renderer. */
	readonly activityKind: DesktopToolActivityKind;
	readonly status: "running" | "complete";
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
	readonly request: DesktopPermissionRequest;
	readonly status: "pending" | "allowed" | "denied" | "cancelled";
	readonly approvalOrigin?: "automatic" | "manual";
}

export interface DesktopExtensionApprovalRequest {
	readonly requestId: string;
	readonly extensionId: string;
	readonly operationId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly reason: string;
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity: "normal" | "sensitive" | "secret";
	readonly presentation: {
		readonly title: string;
		readonly description?: string;
		readonly attributes?: readonly { readonly label: string; readonly value: string }[];
	};
	readonly expiresAt?: number;
}

export interface DesktopExtensionPermissionItem {
	readonly kind: "extension_permission";
	readonly id: string;
	readonly request: DesktopExtensionApprovalRequest;
	readonly status: "pending" | "allowed" | "denied" | "cancelled";
}

export type DesktopPermissionResolution = DesktopToolPermissionResolution | DesktopExtensionPermissionResolution;

export interface DesktopCompactionItem {
	readonly kind: "compaction";
	readonly id: string;
	readonly summary: string;
	readonly timestamp: number;
	readonly status: "compacting" | "complete";
}

export type DesktopTranscriptItem =
	| DesktopMessageItem
	| DesktopThinkingItem
	| DesktopNarrationItem
	| DesktopToolItem
	| DesktopSubagentItem
	| DesktopPermissionItem
	| DesktopExtensionPermissionItem
	| DesktopCompactionItem;

export type DesktopTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface DesktopTodoItem {
	readonly id: string;
	readonly content: string;
	readonly status: DesktopTodoStatus;
}

/** 与 CodingAgentState.todos 同形：Desktop 不再自己维护第二份 Todo 读模型。 */
export type DesktopTodos = readonly DesktopTodoItem[];

export interface DesktopAgentSnapshot {
	readonly sessionId: string;
	readonly status: DesktopAgentStatus;
	readonly items: readonly DesktopTranscriptItem[];
	readonly todos?: DesktopTodos;
	readonly artifacts: readonly DesktopArtifact[];
	readonly lastSeq: number;
}

export type DesktopAgentEvent =
	| { readonly type: "status"; readonly status: DesktopAgentStatus }
	| { readonly type: "transcript_upsert"; readonly item: DesktopTranscriptItem }
	| { readonly type: "transcript_remove"; readonly id: string }
	| { readonly type: "todos_replace"; readonly todos: DesktopTodos }
	| { readonly type: "artifact_upsert"; readonly artifact: DesktopArtifact }
	| { readonly type: "model_catalog_updated" }
	| { readonly type: "connector_oauth_completed"; readonly connectorId: string }
	| { readonly type: "connector_oauth_failed"; readonly connectorId: string; readonly message: string }
	| {
			readonly type: "runtime_error";
			readonly error: { readonly code: string };
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

/**
 * `modelRef` is `<profileId>/<modelId>`, so it must carry a separator.
 *
 * The type stays hand-written because callers pass `readonly` arrays and
 * TypeBox's `Static` always produces a mutable one; the schema is what the
 * router validates against.
 */
export const desktopAgentMessageInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		message: Type.String({ minLength: 1 }),
		modelRef: Type.String({ pattern: "/" }),
		mode: Type.Union([Type.Literal("manual"), Type.Literal("automate"), Type.Literal("plan")]),
		attachments: Type.Optional(Type.Array(desktopMessageAttachmentSchema)),
	},
	{ additionalProperties: false },
);

export interface DesktopAgentMessageInput extends DesktopAgentSessionInput {
	readonly message: string;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
	readonly attachments?: readonly DesktopMessageAttachment[];
}

export const desktopAgentNavigateInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		entryId: Type.String({ minLength: 1 }),
		modelRef: Type.String({ pattern: "/" }),
		mode: Type.Union([Type.Literal("manual"), Type.Literal("automate"), Type.Literal("plan")]),
	},
	{ additionalProperties: false },
);

export interface DesktopAgentNavigateInput extends DesktopAgentSessionInput {
	readonly entryId: string;
	readonly modelRef: string;
	readonly mode: DesktopAgentMode;
}

export const desktopSessionCreateInputSchema = Type.Object(
	{
		projectId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		firstMessage: Type.String({ minLength: 1, pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

export type DesktopSessionCreateInput = Static<typeof desktopSessionCreateInputSchema>;

export const desktopSessionRenameInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		title: Type.String({ minLength: 1, pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

export type DesktopSessionRenameInput = Static<typeof desktopSessionRenameInputSchema>;

export const desktopSessionDeleteInputSchema = Type.Object(
	{ sessionId: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);

export type DesktopSessionDeleteInput = Static<typeof desktopSessionDeleteInputSchema>;

export const desktopSessionMoveInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		toProjectId: Type.Union([Type.String(), Type.Null()]),
	},
	{ additionalProperties: false },
);

export const desktopSessionListInputSchema = Type.Union([
	Type.Undefined(),
	Type.Object(
		{
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
			cursor: Type.Optional(
				Type.Object(
					{ lastActivityAt: Type.Number(), id: Type.String() },
					{ additionalProperties: false },
				),
			),
		},
		{ additionalProperties: false },
	),
]);

export const desktopSessionIdSchema = Type.String({ minLength: 1 });

export const desktopConnectorOAuthApplicationIdSchema = Type.Union([
	Type.Literal("google_drive"),
	Type.Literal("google_gmail"),
	Type.Literal("google_calendar"),
	Type.Literal("github"),
]);

export interface DesktopSessionListPage extends SessionListPage {
	readonly runningSessionIds: readonly string[];
}

export interface DesktopApi {
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
	readonly connector: {
		startOAuth(connectorId: string): Promise<DesktopConnectorOAuthStartResult>;
		disconnectOAuth(connectorId: string): Promise<DesktopProviderConfigSnapshot>;
	};
	readonly project: {
		list(): Promise<DesktopProject[]>;
		choose(): Promise<DesktopProject | null>;
		relink(projectId: string): Promise<DesktopProject | null>;
	};
	readonly session: {
		create(input: DesktopSessionCreateInput): Promise<CodingSession>;
		list(input?: {
			readonly limit?: number;
			readonly cursor?: SessionListCursor;
		}): DesktopSessionListPage;
		rename(input: DesktopSessionRenameInput): Promise<CodingSession>;
		move(input: MoveSessionInput): Promise<CodingSession>;
		delete(input: DesktopSessionDeleteInput): Promise<void>;
	};
	readonly attachment: {
		register(input: DesktopAttachmentRegistrationInput): Promise<DesktopMessageAttachment>;
		release(ids: readonly string[]): void;
	};
	readonly artifact: {
		read(input: DesktopArtifactReadInput): Promise<DesktopArtifactPreview>;
	};
	readonly workspace: {
		list(input: DesktopWorkspaceListInput): Promise<DesktopWorkspaceListResult>;
		read(input: DesktopWorkspaceReadInput): Promise<DesktopWorkspaceFile>;
		openApplications(input: DesktopWorkspaceReadInput): Promise<DesktopWorkspaceOpenApplications>;
		open(input: DesktopWorkspaceOpenInput): Promise<void>;
	};
	readonly agent: {
		send(input: DesktopAgentMessageInput): Promise<{ readonly accepted: true }>;
		navigate(input: DesktopAgentNavigateInput): Promise<void>;
		abort(sessionId: string): void;
		steer(input: DesktopAgentMessageInput): void;
		followUp(input: DesktopAgentMessageInput): void;
		resolvePermission(resolution: DesktopPermissionResolution): void;
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
	getFilePath(file: File): string;
	invoke(request: DesktopRpcRequest): Promise<DesktopRpcResponse>;
	onAgentEvent(listener: (event: DesktopAgentEventEnvelope) => void): () => void;
}
