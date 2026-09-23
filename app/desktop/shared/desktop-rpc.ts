import { type Static, Type } from "@sinclair/typebox";
import type { ConnectorActionPermission } from "@jai/connector";
import type { CodingSession, Project, SessionListCursor, SessionListPage } from "./session";

export type { CodingSession, Project, SessionListCursor, SessionListPage } from "./session";

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

export type DesktopPermissionResolution = Static<typeof desktopPermissionResolutionSchema>;

export const DESKTOP_RPC_CHANNEL = "desktop:rpc";
export const DESKTOP_EVENTS_CHANNEL = "desktop:events";
export const DESKTOP_TERMINAL_EVENTS_CHANNEL = "desktop:terminal-events";

export type DesktopTerminalStatus = "running" | "exited" | "error";
export interface DesktopTerminalSnapshot {
	readonly sessionId: string;
	readonly terminalId: string;
	readonly cwd: string;
	readonly cols: number;
	readonly rows: number;
	readonly status: DesktopTerminalStatus;
	readonly pid: number | null;
	readonly history: string;
	readonly exitCode: number | null;
}
export type DesktopTerminalEvent =
	| { readonly type: "output"; readonly sessionId: string; readonly terminalId: string; readonly data: string; readonly bytes: number }
	| { readonly type: "status"; readonly sessionId: string; readonly terminalId: string; readonly status: DesktopTerminalStatus; readonly exitCode: number | null }
	| { readonly type: "cleared"; readonly sessionId: string; readonly terminalId: string }
	| { readonly type: "restarted"; readonly snapshot: DesktopTerminalSnapshot };
const desktopTerminalStatusSchema = Type.Union([Type.Literal("running"), Type.Literal("exited"), Type.Literal("error")]);
const desktopTerminalSnapshotSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		terminalId: Type.String({ minLength: 1 }),
		cwd: Type.String({ minLength: 1 }),
		cols: Type.Integer({ minimum: 20, maximum: 2_000 }),
		rows: Type.Integer({ minimum: 5, maximum: 1_000 }),
		status: desktopTerminalStatusSchema,
		pid: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
		history: Type.String(),
		exitCode: Type.Union([Type.Integer(), Type.Null()]),
	},
	{ additionalProperties: false },
);
export const desktopTerminalEventSchema = Type.Union([
	Type.Object(
		{
			type: Type.Literal("output"),
			sessionId: Type.String({ minLength: 1 }),
			terminalId: Type.String({ minLength: 1 }),
			data: Type.String(),
			bytes: Type.Integer({ minimum: 0 }),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("status"),
			sessionId: Type.String({ minLength: 1 }),
			terminalId: Type.String({ minLength: 1 }),
			status: desktopTerminalStatusSchema,
			exitCode: Type.Union([Type.Integer(), Type.Null()]),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ type: Type.Literal("cleared"), sessionId: Type.String({ minLength: 1 }), terminalId: Type.String({ minLength: 1 }) },
		{ additionalProperties: false },
	),
	Type.Object({ type: Type.Literal("restarted"), snapshot: desktopTerminalSnapshotSchema }, { additionalProperties: false }),
]);
export const desktopTerminalListInputSchema = Type.Object(
	{ sessionId: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);
const desktopTerminalSessionFields = {
	sessionId: Type.String({ minLength: 1 }),
	terminalId: Type.String({ minLength: 1, maxLength: 128 }),
};
const desktopTerminalSizeFields = {
	cols: Type.Integer({ minimum: 20, maximum: 2_000 }),
	rows: Type.Integer({ minimum: 5, maximum: 1_000 }),
};
export const desktopTerminalSessionInputSchema = Type.Object(desktopTerminalSessionFields, { additionalProperties: false });
export const desktopTerminalOpenInputSchema = Type.Object(
	{ sessionId: Type.String({ minLength: 1 }), ...desktopTerminalSizeFields },
	{ additionalProperties: false },
);
export const desktopTerminalWriteInputSchema = Type.Object(
	{ ...desktopTerminalSessionFields, data: Type.String({ maxLength: 1_048_576 }) },
	{ additionalProperties: false },
);
export const desktopTerminalAckInputSchema = Type.Object(
	{ ...desktopTerminalSessionFields, bytes: Type.Integer({ minimum: 1, maximum: 8_388_608 }) },
	{ additionalProperties: false },
);
export const desktopTerminalResizeInputSchema = Type.Object(
	{ ...desktopTerminalSessionFields, ...desktopTerminalSizeFields },
	{ additionalProperties: false },
);
export type DesktopTerminalSessionInput = Static<typeof desktopTerminalSessionInputSchema>;
export type DesktopTerminalOpenInput = Static<typeof desktopTerminalOpenInputSchema>;
export type DesktopTerminalWriteInput = Static<typeof desktopTerminalWriteInputSchema>;
export type DesktopTerminalAckInput = Static<typeof desktopTerminalAckInputSchema>;
export type DesktopTerminalResizeInput = Static<typeof desktopTerminalResizeInputSchema>;

export const jsonValueSchema = Type.Recursive((This) =>
	Type.Union([
		Type.Null(),
		Type.Boolean(),
		Type.Number(),
		Type.String(),
		Type.Array(This),
		// Structured clone carries `key: undefined`; it reads the same as an omitted optional field.
		Type.Record(Type.String(), Type.Union([This, Type.Undefined()])),
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

export const desktopUiLocalePreferenceSchema = Type.Union([
	Type.Literal("system"),
	Type.Literal("en"),
	Type.Literal("zh-CN"),
]);

export type DesktopUiLocalePreference = Static<typeof desktopUiLocalePreferenceSchema>;
export type DesktopUiLocale = Exclude<DesktopUiLocalePreference, "system">;

export interface DesktopUiLocaleSnapshot {
	readonly preference: DesktopUiLocalePreference;
	readonly locale: DesktopUiLocale;
}

export type DesktopAgentStatus = "idle" | "running";
export type DesktopAgentConnectionStatus = "reconnecting" | "restart_failed";
export type DesktopAgentStopReason = "end_turn" | "cancelled" | "error" | "interrupted";
export interface DesktopProject extends Project {
	readonly available: boolean;
}

export interface DesktopCommandDescriptor {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly commandKind: "file" | "skill";
	readonly argumentHint?: string;
}

export const desktopCommandListInputSchema = Type.Object(
	{
		projectId: Type.Optional(Type.String({ minLength: 1 })),
	},
	{ additionalProperties: false },
);

export type DesktopCommandListInput = Static<typeof desktopCommandListInputSchema>;

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

export type DesktopWorkspaceGitChangeKind = "added" | "conflict" | "deleted" | "modified" | "renamed" | "untracked";

export interface DesktopWorkspaceGitChange {
	readonly path: string;
	readonly oldPath?: string;
	readonly kind: DesktopWorkspaceGitChangeKind;
	readonly staged: boolean;
	readonly unstaged: boolean;
}

export type DesktopWorkspaceGitStatus =
	| { readonly kind: "not-repository" }
	| {
			readonly kind: "repository";
			readonly rootName: string;
			readonly branch: string | null;
			readonly detached: boolean;
			readonly changes: readonly DesktopWorkspaceGitChange[];
	  };

export type DesktopWorkspaceGitDiff =
	| { readonly kind: "not-changed"; readonly path: string }
	| {
			readonly kind: "unavailable";
			readonly path: string;
			readonly oldPath?: string;
			readonly reason: "binary" | "invalid-encoding" | "missing" | "submodule" | "too-large";
	  }
	| {
			readonly kind: "text";
			readonly path: string;
			readonly oldPath?: string;
			readonly changeKind: DesktopWorkspaceGitChangeKind;
			readonly oldContent: string | null;
			readonly newContent: string | null;
	  };

export const desktopWorkspaceGitStatusInputSchema = Type.Object(
	{ sessionId: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);

export const desktopWorkspaceGitDiffInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		path: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

export type DesktopWorkspaceGitStatusInput = Static<typeof desktopWorkspaceGitStatusInputSchema>;
export type DesktopWorkspaceGitDiffInput = Static<typeof desktopWorkspaceGitDiffInputSchema>;

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
export type DesktopModelSource = "catalog" | "fixture" | "unverified";

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
		!model.verified ||
			(model.inputModalities?.includes("text") &&
				model.outputModalities?.includes("text") &&
				model.toolCall === true &&
				model.contextWindow &&
				model.maxTokens),
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
	readonly maxIterations?: number;
	readonly reasoningEffort?: "low" | "medium" | "high";
	readonly providerPresets: readonly DesktopProviderPreset[];
	readonly profiles: readonly DesktopProviderProfile[];
	readonly connector: DesktopConnectorConfigSnapshot;
	readonly webSearch: DesktopWebSearchConfigSnapshot;
}

export type DesktopWebSearchProviderId = "exa" | "parallel" | "anysearch";
export type DesktopWebSearchCredentialId = DesktopWebSearchProviderId | "jina";

export interface DesktopWebSearchProviderSnapshot {
	readonly id: DesktopWebSearchProviderId;
	readonly enabled: boolean;
	readonly order?: number;
	readonly credentialConfigured: boolean;
	readonly credentialMask?: string;
}

export interface DesktopWebSearchConfigSnapshot {
	readonly providers: readonly DesktopWebSearchProviderSnapshot[];
	readonly fetch: DesktopWebSearchFetchConfigSnapshot;
}

export interface DesktopWebSearchFetchConfigSnapshot {
	readonly jina: DesktopWebSearchJinaSnapshot;
}

export interface DesktopWebSearchJinaSnapshot {
	readonly credentialConfigured: boolean;
	readonly credentialMask?: string;
}

export interface DesktopWebSearchProviderInput {
	readonly id: DesktopWebSearchProviderId;
	readonly enabled: boolean;
	readonly order?: number;
	readonly apiKey?: string;
	readonly clearApiKey?: boolean;
}

export interface DesktopWebSearchConfigInput {
	readonly providers: readonly DesktopWebSearchProviderInput[];
	readonly fetch?: DesktopWebSearchFetchConfigInput;
}

export interface DesktopWebSearchFetchConfigInput {
	readonly jina?: DesktopWebSearchJinaInput;
}

export interface DesktopWebSearchJinaInput {
	readonly apiKey?: string;
	readonly clearApiKey?: boolean;
}

/** Safe Desktop projection of the Server-owned Langfuse key pair. */
export interface DesktopTelemetryCredentialSnapshot {
	readonly revision: string | null;
	readonly configured: boolean;
	readonly publicKeyMask?: string;
	readonly secretKeyMask?: string;
}

/** User-visible observability policy. Keys never appear in this read model. */
export interface DesktopTelemetrySettingsSnapshot {
	readonly policyRevision: string | null;
	readonly credential: DesktopTelemetryCredentialSnapshot;
	readonly enabled: boolean;
	readonly endpoint?: string;
	readonly exporter: "langfuse-otlp";
	readonly environmentOverride: boolean;
	readonly configurationError?: string;
}

/**
 * A write-only Langfuse key pair. The renderer keeps these values only in its
 * short-lived form draft; successful calls return DesktopTelemetrySettingsSnapshot.
 */
export interface DesktopTelemetrySettingsInput {
	readonly policyRevision: string | null;
	readonly credentialRevision: string | null;
	readonly enabled: boolean;
	readonly endpoint?: string;
	readonly exporter: "langfuse-otlp";
	readonly publicKey?: string;
	readonly secretKey?: string;
	readonly clearCredentials?: boolean;
}

/** Strict IPC boundary for the write-only observability settings payload. */
export const desktopTelemetrySettingsInputSchema = Type.Object(
	{
		policyRevision: Type.Union([Type.String(), Type.Null()]),
		credentialRevision: Type.Union([Type.String(), Type.Null()]),
		enabled: Type.Boolean(),
		endpoint: Type.Optional(Type.String()),
		exporter: Type.Literal("langfuse-otlp"),
		publicKey: Type.Optional(Type.String()),
		secretKey: Type.Optional(Type.String()),
		clearCredentials: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

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
	readonly maxIterations?: number;
	readonly reasoningEffort?: "low" | "medium" | "high";
	readonly profiles: readonly DesktopProviderProfileInput[];
	readonly connector?: DesktopConnectorConfigInput;
	readonly webSearch?: DesktopWebSearchConfigInput;
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

export interface DesktopWebSearchApiKeyRevealResult {
	readonly credentialId: DesktopWebSearchCredentialId;
	readonly apiKey: string;
}

export interface DesktopConnectorCredentialRevealResult {
	readonly connectorId: string;
	readonly credentialKey: string;
	readonly value: string;
}

export type DesktopTelemetryCredentialId = "public" | "secret";

export interface DesktopTelemetryCredentialRevealResult {
	readonly credentialId: DesktopTelemetryCredentialId;
	readonly value: string;
}

/** Safe Desktop projection of the global MCP configuration stored in ~/.jai/settings.json. */
export interface DesktopMcpSettingsSnapshot {
	readonly revision: string | null;
	readonly mcp: unknown;
}

/** Write-only MCP configuration payload; the renderer keeps this only in its short-lived form draft. */
export interface DesktopMcpSettingsInput {
	readonly revision: string | null;
	readonly mcp: unknown;
}

export type DesktopMcpTransportType = "stdio" | "streamable-http" | "sse";

/** Safe, read-only status of one MCP server connection. Never leaks headers, tokens, cause, or stack. */
export interface DesktopMcpServerStatus {
	readonly name: string;
	readonly type: DesktopMcpTransportType;
	readonly connected: boolean;
	readonly toolCount?: number;
	readonly error?: string;
}

export interface DesktopMcpStatus {
	readonly servers: readonly DesktopMcpServerStatus[];
}

export interface DesktopSlashInvocation {
	readonly name: string;
	readonly kind: "skill" | "command";
	/** Command subtype; absent only for legacy pre-registry Skill metadata. */
	readonly commandKind?: "extension" | "file" | "skill";
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
	readonly stopReason?: DesktopAgentStopReason;
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

/** A safe, read-only projection of one durable ACP `diff.changes` entry. */
export interface DesktopToolFileChange {
	readonly operation: "add" | "modify" | "delete";
	readonly path: string;
}

export interface DesktopWebSearchResult {
	readonly title: string;
	readonly url: string;
}

export interface DesktopToolItem {
	readonly kind: "tool";
	readonly id: string;
	readonly turnId: string;
	readonly activityId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	/** Tool-call journal timestamp, or a local observation while streaming. */
	readonly startedAt?: number;
	/** Tool-result journal timestamp, or a local observation while streaming. */
	readonly completedAt?: number;
	/** Captured at tool registration and execution, never inferred from the name in the renderer. */
	readonly activityKind: DesktopToolActivityKind;
	readonly status: "running" | "complete";
	readonly summary?: string;
	readonly details?: string;
	/** Volatile structured results from the static web_search Extension tool. */
	readonly searchQuery?: string;
	readonly webSearchResults?: readonly DesktopWebSearchResult[];
	/** Present only when the completed tool-result T2 carried ACP diff content. */
	readonly fileChanges?: readonly DesktopToolFileChange[];
}

export interface DesktopSubagentItem {
	readonly kind: "subagent";
	readonly id: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly title: string;
	/** Tool-call journal timestamp, or a local observation while streaming. */
	readonly startedAt?: number;
	/** Tool-result journal timestamp, or a local observation while streaming. */
	readonly completedAt?: number;
	readonly status: "running" | "complete" | "error";
	readonly activityTitle?: string;
}

export interface DesktopSubagentTranscriptInput {
	readonly sessionId: string;
	readonly toolCallId: string;
}

/** Read-only projection of a subagent's journal transcript. */
export interface DesktopSubagentTranscript {
	readonly items: readonly DesktopTranscriptItem[];
	readonly runs: readonly DesktopRunTiming[];
}

export interface DesktopPermissionItem {
	readonly kind: "permission";
	readonly id: string;
	readonly request: DesktopPermissionRequest;
	readonly status: "pending" | "allowed" | "denied" | "cancelled";
	readonly requestedAt: number;
	readonly resolvedAt?: number;
	readonly approvalOrigin?: "automatic" | "manual";
}

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
	| DesktopCompactionItem;

export type DesktopTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface DesktopTodoItem {
	readonly id: string;
	readonly content: string;
	readonly status: DesktopTodoStatus;
}

/** 来自 ACP plan 的 Todo 只读投影；业务状态由 Todo Extension 维护。 */
export type DesktopTodos = readonly DesktopTodoItem[];

/**
 * Current-branch session usage. All fields are finite numbers.
 * Zeros mean empty branch or provider-reported zero — not a separate unknown sentinel.
 */
export interface DesktopSessionUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly totalTokens: number;
	readonly cost: number;
	/** Size of the latest request on the branch: how full the context window is. */
	readonly contextTokens: number;
}

export const EMPTY_DESKTOP_SESSION_USAGE: DesktopSessionUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	totalTokens: 0,
	cost: 0,
	contextTokens: 0,
};

/** Profile lifetime token projection. Same empty/finite semantics as session usage. */
export type DesktopProfileTokenAvailability = "empty" | "complete" | "partial";

export interface DesktopProfileTokenDay {
	readonly date: string;
	readonly totalTokens: number;
}

export interface DesktopProfileTokenModelShare {
	readonly provider: string;
	readonly modelId: string;
	readonly totalTokens: number;
}

export interface DesktopProfileTokenStats {
	readonly availability: DesktopProfileTokenAvailability;
	readonly totalTokens: number;
	readonly peakDayTokens: number;
	readonly peakDayDate: string;
	readonly days: readonly DesktopProfileTokenDay[];
	readonly models: readonly DesktopProfileTokenModelShare[];
	readonly promptCount: number;
	readonly settledAttemptCount: number;
	readonly missingUsageAttemptCount: number;
}

export const EMPTY_DESKTOP_PROFILE_TOKEN_STATS: DesktopProfileTokenStats = {
	availability: "empty",
	totalTokens: 0,
	peakDayTokens: 0,
	peakDayDate: "",
	days: [],
	models: [],
	promptCount: 0,
	settledAttemptCount: 0,
	missingUsageAttemptCount: 0,
};

/** Durable bounds of one run (Operation); a work group's `turnId` is its `operationId`. */
export interface DesktopRunTiming {
	readonly operationId: string;
	readonly startedAt?: number;
	readonly finishedAt?: number;
}

export interface DesktopAgentSnapshot {
	readonly sessionId: string;
	readonly status: DesktopAgentStatus;
	readonly connectionStatus?: DesktopAgentConnectionStatus;
	readonly stopReason?: DesktopAgentStopReason;
	readonly items: readonly DesktopTranscriptItem[];
	readonly runs: readonly DesktopRunTiming[];
	readonly todos?: DesktopTodos;
	readonly artifacts: readonly DesktopArtifact[];
	readonly usage: DesktopSessionUsage;
	readonly lastSeq: number;
}

export type DesktopAgentEvent =
	| {
			readonly type: "status";
			readonly status: DesktopAgentStatus;
			readonly stopReason?: DesktopAgentStopReason;
	  }
	| {
			readonly type: "connection_status";
			readonly status?: DesktopAgentConnectionStatus;
	  }
	| { readonly type: "transcript_upsert"; readonly item: DesktopTranscriptItem }
	| { readonly type: "transcript_remove"; readonly id: string }
	| { readonly type: "run_upsert"; readonly run: DesktopRunTiming }
	| { readonly type: "subagent_transcript_changed"; readonly toolCallId: string }
	| { readonly type: "todos_replace"; readonly todos: DesktopTodos }
	| { readonly type: "artifact_upsert"; readonly artifact: DesktopArtifact }
	| { readonly type: "usage_changed"; readonly usage: DesktopSessionUsage }
	| { readonly type: "model_catalog_updated" }
	| { readonly type: "connector_oauth_completed"; readonly connectorId: string }
	| { readonly type: "connector_oauth_failed"; readonly connectorId: string }
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

export const desktopProjectCreateInputSchema = Type.Object(
	{
		name: Type.String({ minLength: 1, pattern: "\\S" }),
		path: Type.String({ minLength: 1, pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

export type DesktopProjectCreateInput = Static<typeof desktopProjectCreateInputSchema>;

export const desktopProjectReorderInputSchema = Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true });

export const desktopProjectExpandedInputSchema = Type.Object(
	{
		projectId: Type.String({ minLength: 1 }),
		expanded: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export type DesktopProjectExpandedInput = Static<typeof desktopProjectExpandedInputSchema>;

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

export const desktopSessionArchiveInputSchema = Type.Object(
	{ sessionId: Type.String({ minLength: 1 }) },
	{ additionalProperties: false },
);

export type DesktopSessionArchiveInput = Static<typeof desktopSessionArchiveInputSchema>;

export const desktopSessionPinInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		pinned: Type.Boolean(),
	},
	{ additionalProperties: false },
);

export type DesktopSessionPinInput = Static<typeof desktopSessionPinInputSchema>;

export const desktopSessionListInputSchema = Type.Union([
	Type.Undefined(),
	Type.Object(
		{
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
			archived: Type.Optional(Type.Boolean()),
			projectId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
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

/** 设置页一次最多读这么多字节。更早的内容留在磁盘上。 */
export const DESKTOP_LOG_TAIL_BYTES = 64 * 1024;

export const desktopLogFileInputSchema = Type.Object(
	{
		id: Type.String({
			minLength: 1,
			maxLength: 200,
			pattern: "^(desktop|runtime-host)/[A-Za-z0-9][A-Za-z0-9._-]*$",
		}),
	},
	{ additionalProperties: false },
);

export interface DesktopLogFile {
	readonly id: string;
	readonly name: string;
	readonly directory: "desktop" | "runtime-host";
	readonly bytes: number;
	readonly modifiedAt: number;
	readonly active: boolean;
}

export interface DesktopLogTail {
	readonly id: string;
	readonly text: string;
	readonly truncated: boolean;
	readonly bytes: number;
}

export const desktopContextMenuItemSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		label: Type.String({ minLength: 1 }),
		separatorBefore: Type.Optional(Type.Boolean()),
		destructive: Type.Optional(Type.Boolean()),
		iconDataUrl: Type.Optional(
			Type.String({ minLength: 1, maxLength: 64_000, pattern: "^data:image/png;base64," }),
		),
	},
	{ additionalProperties: false },
);

export const desktopContextMenuPositionSchema = Type.Object(
	{
		x: Type.Number(),
		y: Type.Number(),
	},
	{ additionalProperties: false },
);

export const desktopContextMenuShowInputSchema = Type.Object(
	{
		items: Type.Array(desktopContextMenuItemSchema, { minItems: 1 }),
		position: Type.Optional(desktopContextMenuPositionSchema),
	},
	{ additionalProperties: false },
);

export type DesktopContextMenuItem = Static<typeof desktopContextMenuItemSchema>;
export type DesktopContextMenuPosition = Static<typeof desktopContextMenuPositionSchema>;
export type DesktopContextMenuShowInput = Static<typeof desktopContextMenuShowInputSchema>;

export const desktopSubagentTranscriptInputSchema = Type.Object(
	{
		sessionId: Type.String({ minLength: 1 }),
		toolCallId: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

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
	readonly logs: {
		list(): Promise<readonly DesktopLogFile[]>;
		read(input: { readonly id: string }): Promise<DesktopLogTail>;
		clear(input: { readonly id: string }): Promise<void>;
		deleteRotated(): Promise<{ readonly deleted: number }>;
		reveal(input: { readonly id: string }): Promise<void>;
		openDirectory(): Promise<void>;
	};
	readonly locale: {
		get(): DesktopUiLocaleSnapshot;
		set(preference: DesktopUiLocalePreference): Promise<DesktopUiLocaleSnapshot>;
	};
	readonly contextMenu: {
		/** Shows a native OS menu. Returns the selected item id, or null if dismissed. */
		show(input: DesktopContextMenuShowInput): Promise<string | null>;
	};
	readonly provider: {
		get(): Promise<DesktopProviderConfigSnapshot>;
		save(input: DesktopProviderConfigInput): Promise<DesktopProviderConfigSnapshot>;
		fetchModels(profileId: string): Promise<DesktopProviderFetchModelsResult>;
		revealApiKey(profileId: string): Promise<DesktopProviderApiKeyRevealResult>;
		revealWebSearchApiKey(credentialId: DesktopWebSearchCredentialId): Promise<DesktopWebSearchApiKeyRevealResult>;
	};
	readonly telemetry: {
		get(): Promise<DesktopTelemetrySettingsSnapshot>;
		save(input: DesktopTelemetrySettingsInput): Promise<DesktopTelemetrySettingsSnapshot>;
		revealCredential(credentialId: DesktopTelemetryCredentialId): Promise<DesktopTelemetryCredentialRevealResult>;
	};
	readonly mcp: {
		get(): Promise<DesktopMcpSettingsSnapshot>;
		save(input: DesktopMcpSettingsInput): Promise<DesktopMcpSettingsSnapshot>;
		status(): Promise<DesktopMcpStatus>;
	};
	readonly connector: {
		revealCredential(connectorId: string, credentialKey: string): Promise<DesktopConnectorCredentialRevealResult>;
		startOAuth(connectorId: string): Promise<DesktopConnectorOAuthStartResult>;
		disconnectOAuth(connectorId: string): Promise<DesktopProviderConfigSnapshot>;
	};
	readonly profile: {
		/** Durable current-branch token aggregation across catalog Sessions. */
		getTokenStats(): Promise<DesktopProfileTokenStats>;
	};
	readonly project: {
		list(): Promise<DesktopProject[]>;
		/** Opens the native folder picker. Returns null when the user cancels. */
		pickDirectory(): Promise<string | null>;
		create(input: DesktopProjectCreateInput): Promise<DesktopProject>;
		relink(projectId: string): Promise<DesktopProject | null>;
		/** Persists the sidebar order; must list every project exactly once. */
		reorder(projectIds: readonly string[]): Promise<void>;
		setExpanded(input: DesktopProjectExpandedInput): Promise<void>;
		/** Opens the catalog directory in the OS file manager. */
		reveal(projectId: string): Promise<void>;
	};
	readonly session: {
		create(input: DesktopSessionCreateInput): Promise<CodingSession>;
		get(sessionId: string): Promise<CodingSession>;
		list(input?: {
			readonly limit?: number;
			readonly archived?: boolean;
			readonly cursor?: SessionListCursor;
			readonly projectId?: string | null;
		}): Promise<DesktopSessionListPage>;
		rename(input: DesktopSessionRenameInput): Promise<CodingSession>;
		archive(input: DesktopSessionArchiveInput): Promise<CodingSession>;
		restore(input: DesktopSessionArchiveInput): Promise<CodingSession>;
		pin(input: DesktopSessionPinInput): Promise<CodingSession>;
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
		gitStatus(input: DesktopWorkspaceGitStatusInput): Promise<DesktopWorkspaceGitStatus>;
		gitDiff(input: DesktopWorkspaceGitDiffInput): Promise<DesktopWorkspaceGitDiff>;
		openApplications(input: DesktopWorkspaceReadInput): Promise<DesktopWorkspaceOpenApplications>;
		open(input: DesktopWorkspaceOpenInput): Promise<void>;
	};
	readonly terminal: {
		attach(input: { readonly sessionId: string }): readonly DesktopTerminalSnapshot[];
		detach(input: { readonly sessionId: string }): void;
		open(input: DesktopTerminalOpenInput): Promise<DesktopTerminalSnapshot>;
		write(input: DesktopTerminalWriteInput): void;
		ack(input: DesktopTerminalAckInput): void;
		resize(input: DesktopTerminalResizeInput): void;
		close(input: DesktopTerminalSessionInput): Promise<void>;
	};
	readonly command: {
		list(input?: DesktopCommandListInput): Promise<readonly DesktopCommandDescriptor[]>;
	};
	readonly agent: {
		send(input: DesktopAgentMessageInput): Promise<{ readonly accepted: true }>;
		navigate(input: DesktopAgentNavigateInput): Promise<void>;
		abort(sessionId: string): void;
		steer(input: DesktopAgentMessageInput): void;
		followUp(input: DesktopAgentMessageInput): Promise<{ readonly accepted: true }>;
		resolvePermission(resolution: DesktopPermissionResolution): void;
		retryConnection(): Promise<void>;
		getSnapshot(sessionId: string): Promise<DesktopAgentSnapshot>;
		getSubagentTranscript(input: DesktopSubagentTranscriptInput): Promise<DesktopSubagentTranscript>;
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
	onTerminalEvent(listener: (event: DesktopTerminalEvent) => void): () => void;
}
