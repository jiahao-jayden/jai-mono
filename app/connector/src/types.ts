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
export type ConnectorActionPermission = "ask" | "allow" | "deny";
export type ConnectorActionApprovalMode = Exclude<ConnectorActionPermission, "deny">;

export interface ConnectorDefinition {
	readonly id: string;
	readonly displayName: string;
	readonly description?: string;
	readonly categories?: readonly string[];
	readonly authTypes: readonly string[];
}

export interface ActionDefinition {
	readonly connectorId: string;
	readonly actionId: string;
	readonly description: string;
	readonly inputSchema: JsonSchema;
	readonly outputSchema: JsonSchema;
	readonly requiredScopes: readonly string[];
	readonly sideEffect: ActionSideEffect;
	readonly dataSensitivity: ActionDataSensitivity;
}

export interface ConnectionRecord {
	readonly connectorId: string;
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

export interface ConnectorAdapter {
	readonly definition: ConnectorDefinition;
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
	readonly disabledConnectors?: readonly string[];
}

export interface ConnectorConfiguration {
	readonly enabled?: boolean;
	/** Connector API keys, OAuth tokens and custom credentials are intentionally persisted as settings values. */
	readonly credentials?: Readonly<Record<string, string>>;
}

export interface ConnectorSettings {
	readonly policy?: ConnectorPolicy;
	readonly connectors?: Readonly<Record<string, ConnectorConfiguration>>;
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
	readonly connectorId: string;
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
	readonly connectorId: string;
	readonly displayName: string;
	readonly status: ConnectionRecord["status"];
	readonly scopes: readonly string[];
}

export interface SearchActionsInput {
	readonly query?: string;
	readonly connectorId?: string;
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
	readonly connectorId: string;
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

export interface PrepareActionInput {
	readonly actionId: string;
	readonly input: JsonObject;
}

export interface PreparedConnectorAction {
	readonly preparationId: string;
	readonly actionId: string;
	readonly description: string;
	readonly sideEffect: ActionSideEffect;
	readonly dataSensitivity: ActionDataSensitivity;
	readonly approvalMode: ConnectorActionApprovalMode;
	readonly expiresAt: number;
}

export interface ExecuteActionResponse {
	readonly status: "completed";
	readonly actionId: string;
	readonly output: JsonValue;
}

export interface HealthResponse {
	readonly status: "ready";
	readonly protocolVersion: 1;
	readonly connectorCount: number;
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
	prepareAction(
		input: PrepareActionInput,
		context: RequestContext,
	): Promise<ResultType<PreparedConnectorAction, ConnectorFailure>>;
	executePreparedAction(
		action: PreparedConnectorAction,
		context: RequestContext,
	): Promise<ResultType<ExecuteActionResponse, ConnectorFailure>>;
	discardPreparedAction(
		action: PreparedConnectorAction,
		context: RequestContext,
	): Promise<ResultType<void, ConnectorFailure>>;
	health(context: RequestContext): Promise<ResultType<HealthResponse, ConnectorFailure>>;
}

export type ConnectorFailure =
	| import("./errors").ConnectorActionNotFound
	| import("./errors").ConnectorConnectionNotFound
	| import("./errors").ConnectorConnectionUnavailable
	| import("./errors").ConnectorInputInvalid
	| import("./errors").ConnectorPolicyDenied
	| import("./errors").ConnectorPreparationInvalid
	| import("./errors").ConnectorUpstreamFailed
	| import("./errors").ConnectorUpstreamRateLimited
	| import("./errors").ConnectorUpstreamUnavailable
	| import("./errors").ConnectorRequestCancelled
	| import("./errors").ConnectorProtocolInvalid;
