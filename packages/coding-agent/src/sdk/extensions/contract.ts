import type { TObject, TSchema } from "@sinclair/typebox";
import type { Result as ResultType } from "better-result";
import type {
	CodingCommandContext,
	CodingCommandExecutionFailed,
	CodingCommandKind,
	CodingCommandResult,
} from "../../commands";
import type { JsonObject, JsonValue } from "../../core/json";
import type { CodingExtensionToolCall, CodingToolPermission } from "../../permissions/tool-permission";
import type { CodingExtensionError, CodingExtensionOperationFailed } from "../extension-errors";
import type { CodingToolActivityKind } from "../tool-presentation";
import type { CodingPermissionMode } from "../types";

export interface CodingExtensionConfiguration<TConfig extends JsonObject = JsonObject> {
	readonly scope: "user" | "project";
	readonly schema: TObject;
	readonly defaultValue: TConfig;
}

export interface CodingExtensionConfigurationStore<TConfig extends JsonObject = JsonObject> {
	readonly value: TConfig;
	readonly persistent: boolean;
	update(next: TConfig): Promise<ResultType<TConfig, CodingExtensionError>>;
}

export interface CodingExtensionSessionState<TState extends JsonObject = JsonObject> {
	readonly schema: TObject;
	readonly defaultValue: TState;
}

export interface CodingExtensionSessionStateStore<TState extends JsonObject = JsonObject> {
	readonly value: TState;
	update(update: (current: TState) => TState): Promise<ResultType<TState, CodingExtensionError>>;
}

export interface CodingExtensionApprovalPresentation {
	readonly title: string;
	readonly description?: string;
	readonly attributes?: readonly { readonly label: string; readonly value: string }[];
}

export interface CodingExtensionApprovalRequest {
	readonly requestId: string;
	readonly extensionId: string;
	readonly operationId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly reason: string;
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity: "normal" | "sensitive" | "secret";
	readonly presentation: CodingExtensionApprovalPresentation;
	readonly expiresAt?: number;
}

export type CodingExtensionApprovalDecision = "deny" | "allowOnce" | "allow";

export interface CodingExtensionRuntimeAdapter {
	readConfiguration?(input: {
		readonly extensionId: string;
		readonly scope: "user" | "project";
	}):
		| ResultType<JsonObject | undefined, CodingExtensionError>
		| Promise<ResultType<JsonObject | undefined, CodingExtensionError>>;
	writeConfiguration?(input: {
		readonly extensionId: string;
		readonly scope: "user" | "project";
		readonly value: JsonObject;
	}): ResultType<JsonObject, CodingExtensionError> | Promise<ResultType<JsonObject, CodingExtensionError>>;
	requestApproval?(
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	):
		| ResultType<CodingExtensionApprovalDecision, CodingExtensionError>
		| Promise<ResultType<CodingExtensionApprovalDecision, CodingExtensionError>>;
	reportDiagnostic?(diagnostic: CodingExtensionDiagnostic): void | Promise<void>;
}

export interface CodingExtensionContext<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
> {
	readonly sessionId: string;
	readonly cwd: string;
	readonly permissionMode: CodingPermissionMode;
	readonly configuration: CodingExtensionConfigurationStore<TConfig>;
	readonly sessionState: CodingExtensionSessionStateStore<TState>;
	requestApproval(
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	): Promise<ResultType<CodingExtensionApprovalDecision, CodingExtensionError>>;
	registerCommand(
		command: CodingExtensionCommand<TConfig, TState>,
	): ResultType<CodingExtensionCommandRegistration, CodingExtensionOperationFailed>;
}

export interface CodingExtensionCommandRegistration {
	unregister(): void;
}

export interface CodingExtensionCommandContext<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
> extends CodingCommandContext {
	readonly extensionId: string;
	readonly configuration: CodingExtensionConfigurationStore<TConfig>;
	readonly sessionState: CodingExtensionSessionStateStore<TState>;
	requestApproval(
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	): Promise<ResultType<CodingExtensionApprovalDecision, CodingExtensionError>>;
}

export interface CodingExtensionCommand<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
> {
	readonly name: string;
	readonly description: string;
	readonly displayName?: string;
	readonly kind?: CodingCommandKind;
	handler(
		args: string,
		context: CodingExtensionCommandContext<TConfig, TState>,
	):
		| ResultType<CodingCommandResult, CodingCommandExecutionFailed>
		| Promise<ResultType<CodingCommandResult, CodingCommandExecutionFailed>>;
}

export interface CodingExtensionRuntime<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> extends CodingExtensionContext<TConfig, TState> {
	readonly instance: TInstance;
}

export interface CodingExtensionToolResult {
	readonly content: readonly (
		| { readonly type: "text"; readonly text: string }
		| { readonly type: "image"; readonly image: string; readonly mimeType: string }
	)[];
	readonly details?: JsonValue;
	readonly terminate?: boolean;
}

export interface CodingExtensionTool<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
	TParameters extends TSchema = TSchema,
> {
	readonly name: string;
	readonly description: string;
	readonly parameters: TParameters;
	readonly authorization:
		| {
				readonly owner: "core";
				readonly permission:
					| CodingToolPermission
					| CodingExtensionToolPermissionResolver<TConfig, TState, TInstance>;
		  }
		| { readonly owner: "extension" };
	readonly execute: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		call: CodingExtensionToolCall<JsonObject>,
	) => CodingExtensionToolResult | Promise<CodingExtensionToolResult>;
	readonly presentation?: CodingExtensionToolPresentation<TConfig, TState, TInstance>;
	readonly executionMode?: "sequential" | "parallel";
}

/** A Coding Agent SDK projection. It does not affect execution or authorization. */
export interface CodingExtensionToolPresentation<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> {
	readonly activityKind?: CodingToolActivityKind;
	readonly title?: (runtime: CodingExtensionRuntime<TConfig, TState, TInstance>, args: JsonObject) => string;
	readonly resolveActivityKind?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		args: JsonObject,
	) => CodingToolActivityKind | undefined;
}

export type CodingExtensionToolPermissionResolver<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> = (
	runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
	call: CodingExtensionToolCall<JsonObject>,
) => CodingToolPermission | Promise<CodingToolPermission>;

export interface CodingBeforeToolCallInput {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args: JsonObject;
}

export type CodingBeforeToolCallResult =
	| { readonly kind: "continue"; readonly args?: JsonObject }
	| { readonly kind: "block"; readonly reason: string };

export interface CodingAfterToolCallInput {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args: JsonObject;
	readonly result: CodingExtensionToolResult;
	readonly isError: boolean;
}

export interface CodingBeforeAgentStartInput {
	readonly prompt: string;
}

export type CodingBeforeAgentStartResult =
	| { readonly kind: "continue" }
	| { readonly kind: "block"; readonly reason: string };

/** The extension receives no transcript or provider payload. */
export interface CodingBeforeModelCallInput {}

export interface CodingBeforeModelCallResult {
	/** Appended as a synthetic context message for this request only. */
	readonly context?: string;
}

export interface CodingTurnEndInput {
	readonly outcome: "completed" | "aborted" | "iteration_limit" | "failed";
}

export interface CodingAgentSettledInput {
	readonly idleEpoch: number;
	readonly outcome: "completed" | "aborted" | "iteration_limit" | "failed";
}

export interface CodingExtensionHooks<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> {
	readonly beforeAgentStart?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		input: CodingBeforeAgentStartInput,
	) => CodingBeforeAgentStartResult | Promise<CodingBeforeAgentStartResult>;
	readonly turnStart?: (runtime: CodingExtensionRuntime<TConfig, TState, TInstance>) => void | Promise<void>;
	readonly turnEnd?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		input: CodingTurnEndInput,
	) => void | Promise<void>;
	readonly beforeModelCall?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		input: CodingBeforeModelCallInput,
	) => CodingBeforeModelCallResult | undefined | Promise<CodingBeforeModelCallResult | undefined>;
	readonly afterModelCall?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		input: CodingTurnEndInput,
	) => void | Promise<void>;
	readonly sessionStart?: (runtime: CodingExtensionRuntime<TConfig, TState, TInstance>) => void | Promise<void>;
	readonly beforeToolCall?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		input: CodingBeforeToolCallInput,
	) => CodingBeforeToolCallResult | undefined | Promise<CodingBeforeToolCallResult | undefined>;
	readonly afterToolCall?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		input: CodingAfterToolCallInput,
	) => void | Promise<void>;
	readonly agentSettled?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		input: CodingAgentSettledInput,
	) => void | Promise<void>;
}

export interface CodingExtensionLifecycle<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> {
	readonly activate?: (
		context: CodingExtensionContext<TConfig, TState>,
	) =>
		| ResultType<TInstance, CodingExtensionOperationFailed>
		| Promise<ResultType<TInstance, CodingExtensionOperationFailed>>;
	readonly deactivate?: (runtime: CodingExtensionRuntime<TConfig, TState, TInstance>) => void | Promise<void>;
}

export interface CodingExtensionDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly extensionId: string;
	readonly catalogId?: string;
}

export interface CodingExtensionToolCatalog<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> {
	readonly id: string;
	discover(
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		signal?: AbortSignal,
	):
		| ResultType<CodingToolCatalogDiscovery<TConfig, TState, TInstance>, CodingExtensionOperationFailed>
		| Promise<ResultType<CodingToolCatalogDiscovery<TConfig, TState, TInstance>, CodingExtensionOperationFailed>>;
}

export interface CodingToolCatalogDiscovery<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> {
	readonly tools: readonly CodingExtensionTool<TConfig, TState, TInstance>[];
	readonly diagnostics?: readonly CodingExtensionDiagnostic[];
}

export interface CodingAgentExtension<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> {
	readonly id: string;
	readonly configuration?: CodingExtensionConfiguration<TConfig>;
	readonly sessionState?: CodingExtensionSessionState<TState>;
	readonly tools?: readonly CodingExtensionTool<TConfig, TState, TInstance>[];
	readonly hooks?: CodingExtensionHooks<TConfig, TState, TInstance>;
	readonly catalogs?: readonly CodingExtensionToolCatalog<TConfig, TState, TInstance>[];
	readonly lifecycle?: CodingExtensionLifecycle<TConfig, TState, TInstance>;
}

/** Host-provided persistence for per-session Extension state. */
export interface CodingExtensionSessionStateAdapter {
	read(extensionId: string): Promise<ResultType<JsonObject | undefined, CodingExtensionError>>;
	update(
		extensionId: string,
		update: (current: JsonObject | undefined) => ResultType<JsonObject, CodingExtensionError>,
	): Promise<ResultType<JsonObject, CodingExtensionError>>;
}

export type { CodingExtensionToolCall, CodingToolPermission };
