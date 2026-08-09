import type { Result as ResultType } from "better-result";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
		return true;
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function isJsonObject(value: unknown): value is JsonObject {
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type JsonSchema = {
	readonly type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
	readonly description?: string;
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly additionalProperties?: boolean;
	readonly items?: JsonSchema;
	readonly enum?: readonly JsonValue[];
	readonly minLength?: number;
	readonly maxLength?: number;
};

export type ActionSideEffect = "read" | "write" | "destructive";
export type ActionDataSensitivity = "normal" | "sensitive" | "secret";
export type ConnectorActionPermission = "allow" | "ask" | "deny";

export interface ProviderDefinition {
	readonly id: string;
	readonly displayName: string;
	readonly description?: string;
	readonly categories?: readonly string[];
	readonly authTypes: readonly string[];
}

export interface ActionDefinition {
	readonly providerId: string;
	readonly actionId: string;
	readonly description: string;
	readonly inputSchema: JsonSchema;
	readonly outputSchema: JsonSchema;
	readonly requiredScopes: readonly string[];
	readonly sideEffect: ActionSideEffect;
	readonly dataSensitivity: ActionDataSensitivity;
}

export interface ConnectionRecord {
	readonly providerId: string;
	readonly displayName: string;
	readonly status: "connected" | "expired" | "missing_scope" | "disconnected";
	readonly scopes: readonly string[];
}

export interface ActionExecutionContext {
	readonly requestId: string;
	readonly sessionId: string;
	readonly connection: ConnectionRecord;
	/** Internal Service-only credentials; never included in a wire DTO or Agent tool result. */
	readonly credentials: Readonly<Record<string, string>>;
	readonly signal?: AbortSignal;
}

export interface ProviderAdapter {
	readonly definition: ProviderDefinition;
	readonly actions: readonly ActionDefinition[];
	execute(
		action: ActionDefinition,
		input: JsonObject,
		context: ActionExecutionContext,
	): Promise<ResultType<JsonValue, ConnectorFailure>>;
}

export interface ConnectorPolicy {
	readonly default?: ConnectorActionPermission;
	readonly actions?: Readonly<Record<string, ConnectorActionPermission>>;
	readonly disabledProviders?: readonly string[];
}

export interface ConnectorProviderSettings {
	readonly enabled?: boolean;
	/** Provider API keys, OAuth tokens and custom credentials are intentionally persisted as settings values. */
	readonly credentials?: Readonly<Record<string, string>>;
}

export interface ConnectorSettings {
	readonly policy?: ConnectorPolicy;
	readonly providers?: Readonly<Record<string, ConnectorProviderSettings>>;
}

export interface ConnectorConfigSnapshot {
	readonly settings: ConnectorSettings;
	/** Revision of the user settings scope; null means the file does not exist. */
	readonly revision: string | null;
}

export type ConnectorConfigFailure =
	| import("./errors").ConnectorConfigReadFailed
	| import("./errors").ConnectorConfigWriteFailed
	| import("./errors").ConnectorConfigConflict;

export type ConnectorConfigWatchEvent =
	| { readonly status: "valid"; readonly snapshot: ConnectorConfigSnapshot }
	| {
			readonly status: "invalid";
			readonly error: ConnectorConfigFailure;
			readonly lastValid?: ConnectorConfigSnapshot;
	  };

export interface ConnectorConfigStore {
	load(): Promise<ResultType<ConnectorConfigSnapshot, ConnectorConfigFailure>>;
	save(
		settings: ConnectorSettings,
		options: { readonly expectedRevision: string | null },
	): Promise<ResultType<ConnectorConfigSnapshot, ConnectorConfigFailure>>;
	watch(listener: (event: ConnectorConfigWatchEvent) => void): () => void;
	close(): void;
}

export interface RequestContext {
	readonly requestId: string;
	readonly sessionId?: string;
	readonly signal?: AbortSignal;
}

export interface ListAppsResponse {
	readonly apps: readonly AppSummary[];
}

export interface AppSummary {
	readonly providerId: string;
	readonly displayName: string;
	readonly description?: string;
	readonly categories: readonly string[];
	readonly authTypes: readonly string[];
	readonly enabled: boolean;
	readonly actionCount: number;
	readonly connectionCount: number;
}

export interface ListConnectionsResponse {
	readonly connections: readonly ConnectionSummary[];
}

export interface ConnectionSummary {
	readonly providerId: string;
	readonly displayName: string;
	readonly status: ConnectionRecord["status"];
	readonly scopes: readonly string[];
}

export interface SearchActionsInput {
	readonly query?: string;
	readonly providerId?: string;
	readonly sideEffect?: ActionSideEffect;
	readonly limit?: number;
	readonly cursor?: string;
}

export interface SearchActionsResponse {
	readonly actions: readonly ActionSummary[];
	readonly nextCursor: string | null;
}

export interface ActionSummary {
	readonly actionId: string;
	readonly providerId: string;
	readonly description: string;
	readonly policy: ConnectorActionPermission;
	readonly sideEffect: ActionSideEffect;
	readonly dataSensitivity: ActionDataSensitivity;
	readonly requiredScopes: readonly string[];
	readonly requiresGuide: boolean;
}

export interface GetActionGuideInput {
	readonly actionId: string;
}

export interface ActionGuideResponse {
	readonly action: ActionDefinition;
	readonly policy: ConnectorActionPermission;
}

export interface ExecuteActionInput {
	readonly actionId: string;
	readonly input: JsonObject;
	readonly approvalId?: string;
}

export interface ApprovalPreview {
	readonly actionId: string;
	readonly description: string;
	readonly sideEffect: ActionSideEffect;
	readonly dataSensitivity: ActionDataSensitivity;
	readonly inputKeys: readonly string[];
	readonly expiresAt: number;
}

export type ExecuteActionResponse =
	| {
			readonly status: "completed";
			readonly actionId: string;
			readonly output: JsonValue;
	  }
	| {
			readonly status: "approval_required";
			readonly actionId: string;
			readonly approvalId: string;
			readonly approval: ApprovalPreview;
	  };

export interface HealthResponse {
	readonly status: "ready";
	readonly protocolVersion: 1;
	readonly providerCount: number;
	readonly actionCount: number;
}

export interface ConnectorService {
	listApps(context: RequestContext): Promise<ResultType<ListAppsResponse, ConnectorFailure>>;
	listConnections(context: RequestContext): Promise<ResultType<ListConnectionsResponse, ConnectorFailure>>;
	searchActions(
		input: SearchActionsInput,
		context: RequestContext,
	): Promise<ResultType<SearchActionsResponse, ConnectorFailure>>;
	getActionGuide(
		input: GetActionGuideInput,
		context: RequestContext,
	): Promise<ResultType<ActionGuideResponse, ConnectorFailure>>;
	executeAction(
		input: ExecuteActionInput,
		context: RequestContext,
	): Promise<ResultType<ExecuteActionResponse, ConnectorFailure>>;
	health(context: RequestContext): Promise<ResultType<HealthResponse, ConnectorFailure>>;
}

export type ConnectorFailure =
	| import("./errors").ConnectorActionNotFound
	| import("./errors").ConnectorConnectionNotFound
	| import("./errors").ConnectorConnectionUnavailable
	| import("./errors").ConnectorInputInvalid
	| import("./errors").ConnectorPolicyDenied
	| import("./errors").ConnectorApprovalInvalid
	| import("./errors").ConnectorSessionRequired
	| import("./errors").ConnectorProviderFailed
	| import("./errors").ConnectorProviderRateLimited
	| import("./errors").ConnectorProviderUnavailable
	| import("./errors").ConnectorRequestCancelled
	| import("./errors").ConnectorProtocolInvalid;
