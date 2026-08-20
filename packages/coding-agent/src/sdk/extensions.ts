import type { AgentMessage, AgentTool, ToolMiddleware } from "@jai/agent";
import { validateToolArguments } from "@jai/ai";
import type { TObject, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result, type Result as ResultType, panic } from "better-result";
import {
	CodingExtensionApprovalAborted,
	CodingExtensionConfigurationUnavailable,
	CodingExtensionDeactivationFailed,
	CodingExtensionError,
	CodingExtensionOperationFailed,
	CodingExtensionPersistentApprovalUnavailable,
	CodingExtensionSessionStateUnavailable,
	extensionActivationFailed,
	extensionCapabilityConflict,
	extensionCatalogDiscoveryFailed,
	extensionContractViolation,
	extensionHookFailed,
	extensionOperationFailed,
} from "./extension-errors";
import type { CodingPermissionMode, JsonObject, JsonValue } from "./types";

export interface CodingToolPermission {
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity?: "normal" | "sensitive" | "secret";
	readonly reason: string;
}

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
}

export interface CodingExtensionRuntime<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> extends CodingExtensionContext<TConfig, TState> {
	readonly instance: TInstance;
}

export interface CodingExtensionToolCall<TArguments = JsonObject> {
	readonly toolCallId: string;
	readonly args: TArguments;
	readonly signal?: AbortSignal;
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
				readonly permission: CodingToolPermission | CodingExtensionToolPermissionResolver<TConfig, TState, TInstance>;
		  }
		| { readonly owner: "extension" };
	readonly execute: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
		call: CodingExtensionToolCall<JsonObject>,
	) => CodingExtensionToolResult | Promise<CodingExtensionToolResult>;
	readonly title?: (runtime: CodingExtensionRuntime<TConfig, TState, TInstance>, args: JsonObject) => string;
	readonly executionMode?: "sequential" | "parallel";
}

export type CodingExtensionToolPermissionResolver<
	TConfig extends JsonObject = JsonObject,
	TState extends JsonObject = JsonObject,
	TInstance = undefined,
> = (
	runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
	call: CodingExtensionToolCall<JsonObject>,
) => CodingToolPermission | Promise<CodingToolPermission>;

/**
 * An immutable Skill discovered by an Extension. The SDK reads its content
 * directly from the recorded, canonical path for the duration of a run.
 */
export interface CodingExtensionSkill {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly contentRevision: string;
	readonly location: string;
	readonly directory: string;
	readonly canonicalDirectory: string;
	readonly source: {
		readonly scope: "user" | "project";
		readonly directory: "plugin";
		readonly pluginName: string;
		readonly pluginVersion?: string;
		readonly pluginRoot: string;
	};
	readonly license?: string;
	readonly compatibility?: string;
	readonly allowedTools: readonly string[];
	readonly metadata: Readonly<Record<string, string>>;
}

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
	readonly sessionStart?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
	) => void | Promise<void>;
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
	readonly deactivate?: (
		runtime: CodingExtensionRuntime<TConfig, TState, TInstance>,
	) => void | Promise<void>;
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
	readonly skills?: readonly CodingExtensionSkill[];
	readonly hooks?: CodingExtensionHooks<TConfig, TState, TInstance>;
	readonly catalogs?: readonly CodingExtensionToolCatalog<TConfig, TState, TInstance>[];
	readonly lifecycle?: CodingExtensionLifecycle<TConfig, TState, TInstance>;
}

export function defineExtension<T extends CodingAgentExtension<any, any, any>>(extension: T): T {
	return extension;
}

export interface InitializedExtension {
	readonly id: string;
	readonly extension: CodingAgentExtension<any, any, any>;
	runtime?: CodingExtensionRuntime<any, any, any>;
	readonly tools: AgentTool[];
	readonly catalogTools: AgentTool[];
	readonly skills: readonly CodingExtensionSkill[];
	readonly permissions: Map<string, ResolvedExtensionToolPermission>;
	readonly extensionAuthorizedToolNames: string[];
	reportDiagnostic?: (diagnostic: CodingExtensionDiagnostic) => void | Promise<void>;
}

type ResolvedExtensionToolPermission = (
	call: CodingExtensionToolCall<JsonObject>,
) => CodingToolPermission | Promise<CodingToolPermission>;

interface CodingExtensionSessionStateAdapter {
	read(extensionId: string): Promise<ResultType<JsonObject | undefined, CodingExtensionError>>;
	update(
		extensionId: string,
		update: (current: JsonObject | undefined) => ResultType<JsonObject, CodingExtensionError>,
	): Promise<ResultType<JsonObject, CodingExtensionError>>;
}

export async function initializeExtensions(
	extensions: readonly CodingAgentExtension[],
	context: Omit<CodingExtensionContext, "configuration" | "sessionState" | "requestApproval">,
	runtime?: CodingExtensionRuntimeAdapter,
	sessionState?: CodingExtensionSessionStateAdapter,
	): Promise<ResultType<readonly InitializedExtension[], CodingExtensionError>> {
	const initialized = prepareExtensions(extensions);
	if (initialized.isErr()) return initialized;
	const activation = await activateExtensions(initialized.value, context, runtime, sessionState);
	return activation.isErr() ? activation : Result.ok(initialized.value);
}

export function prepareExtensions(
	extensions: readonly CodingAgentExtension[],
): ResultType<readonly InitializedExtension[], CodingExtensionError> {
	const ids = assertExtensionIds(extensions);
	if (ids.isErr()) return ids;
	const capabilities = assertExtensionCapabilityNames(extensions);
	if (capabilities.isErr()) return capabilities;
	return Result.ok(extensions.map((extension) => createInitializedExtension(extension)));
}

interface ExtensionActivationRegistries {
	readonly permissions?: Map<string, ResolvedExtensionToolPermission>;
	readonly authorizedToolNames?: Set<string>;
}

export async function activateExtensions(
	initialized: readonly InitializedExtension[],
	context: Omit<CodingExtensionContext, "configuration" | "sessionState" | "requestApproval">,
	runtime?: CodingExtensionRuntimeAdapter,
	sessionState?: CodingExtensionSessionStateAdapter,
	registries: ExtensionActivationRegistries = {},
): Promise<ResultType<void, CodingExtensionError>> {
	for (const extension of initialized) {
		extension.reportDiagnostic = runtime?.reportDiagnostic;
		const initializedContext = await extensionContext(extension.extension, context, runtime, sessionState);
		if (initializedContext.isErr()) return rollbackExtensions(initialized, initializedContext.error);
		const instance = await activateExtension(extension.extension, initializedContext.value);
		if (instance.isErr()) return rollbackExtensions(initialized, instance.error);
		const initializedRuntime = { ...initializedContext.value, instance: instance.value };
		extension.runtime = initializedRuntime;
		const catalogTools = await discoverCatalogTools(extension.extension, initializedRuntime);
		if (catalogTools.isErr()) return rollbackExtensions(initialized, catalogTools.error);
		extension.catalogTools.push(...mapExtensionTools(extension, catalogTools.value));
		syncActivationRegistries(initialized, registries);
	}
	const catalogCapabilities = assertCatalogCapabilityNames(
		initialized.map((extension) => extension.extension),
		initialized,
	);
	if (catalogCapabilities.isErr()) return rollbackExtensions(initialized, catalogCapabilities.error);
	for (const extension of initialized) {
		const runtimeValue = extensionRuntime(extension);
		const readiness = await invokeExtensionHook(extension, "session_start", () =>
			extension.extension.hooks?.sessionStart?.(runtimeValue),
		);
		if (readiness.isErr()) return rollbackExtensions(initialized, readiness.error);
	}
	return Result.ok(undefined);
}

function assertExtensionIds(extensions: readonly CodingAgentExtension[]): ResultType<void, CodingExtensionError> {
	const extensionIds = new Set<string>();
	for (const extension of extensions) {
		const id = extension.id.trim();
		if (!id || extensionIds.has(id)) return Result.err(extensionCapabilityConflict("id", extension.id));
		extensionIds.add(id);
	}
	return Result.ok(undefined);
}

export async function disposeExtensions(
	extensions: readonly InitializedExtension[],
): Promise<ResultType<void, CodingExtensionError>> {
	let failure: CodingExtensionError | undefined;
	for (const extension of [...extensions].reverse()) {
		const runtime = extension.runtime;
		if (!runtime) continue;
		try {
			await extension.extension.lifecycle?.deactivate?.(runtime);
		} catch (error) {
			failure ??= new CodingExtensionDeactivationFailed({
				extensionId: extension.id,
				message: `Extension "${extension.id}" deactivation failed`,
				cause: error,
			});
		} finally {
			extension.runtime = undefined;
		}
	}
	return failure ? Result.err(failure) : Result.ok(undefined);
}

async function rollbackExtensions(
	extensions: readonly InitializedExtension[],
	failure: CodingExtensionError,
): Promise<ResultType<never, CodingExtensionError>> {
	await disposeExtensions(extensions);
	return Result.err(failure);
}

export function extensionTools(extensions: readonly InitializedExtension[]): readonly AgentTool[] {
	return extensions.flatMap((extension) => extension.tools);
}

export function extensionCatalogTools(extensions: readonly InitializedExtension[]): readonly AgentTool[] {
	return extensions.flatMap((extension) => extension.catalogTools);
}

export function extensionSkills(extensions: readonly InitializedExtension[]): readonly CodingExtensionSkill[] {
	return extensions.flatMap((extension) => extension.skills);
}

export function extensionPermissions(
	extensions: readonly InitializedExtension[],
	target = new Map<string, ResolvedExtensionToolPermission>(),
): Map<string, ResolvedExtensionToolPermission> {
	target.clear();
	for (const extension of extensions) {
		for (const [name, resolver] of extension.permissions) target.set(name, resolver);
	}
	return target;
}

export function extensionAuthorizedToolNames(
	extensions: readonly InitializedExtension[],
	target = new Set<string>(),
): Set<string> {
	target.clear();
	for (const extension of extensions) {
		for (const name of extension.extensionAuthorizedToolNames) target.add(name);
	}
	return target;
}

export function extensionMiddleware(extensions: readonly InitializedExtension[]): ToolMiddleware {
	return async (context, next) => {
		let args = context.args as JsonObject;
		let transformedBy: InitializedExtension | undefined;
		for (const extension of extensions) {
			let result: CodingBeforeToolCallResult | undefined;
			try {
				result = await extension.extension.hooks?.beforeToolCall?.(extensionRuntime(extension), {
					toolCallId: context.toolCall.id,
					toolName: context.tool.name,
					args: structuredClone(args),
				});
			} catch (error) {
				// ToolMiddleware cannot return Result, so this is the adapter seam that rethrows the classified failure.
				throw extensionHookFailed(extension.id, "before_tool_call", error);
			}
			if (result?.kind === "block") return { content: [{ type: "text", text: result.reason }] };
			if (result?.kind === "continue" && result.args) {
				args = result.args;
				transformedBy = extension;
			}
		}
		const validation = validateToolArguments(context.tool, { ...context.toolCall, arguments: args });
		if (validation.isErr()) {
			throw extensionContractViolation({
				...(transformedBy ? { extensionId: transformedBy.id } : {}),
				message: validation.error.message,
			});
		}
		context.args = validation.value as Record<string, unknown>;
		try {
			const result = await next();
			for (const extension of extensions) {
				await notifyAfterToolCall(extension, {
					toolCallId: context.toolCall.id,
					toolName: context.tool.name,
					args: structuredClone(context.args) as JsonObject,
					result: result as CodingExtensionToolResult,
					isError: false,
				});
			}
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Tool execution failed";
			for (const extension of extensions) {
				await notifyAfterToolCall(extension, {
					toolCallId: context.toolCall.id,
					toolName: context.tool.name,
					args: structuredClone(context.args) as JsonObject,
					result: { content: [{ type: "text", text: message }] },
					isError: true,
				});
			}
			throw error;
		}
	};
}

export async function extensionBeforeAgentStart(
	extensions: readonly InitializedExtension[],
	prompt: string,
): Promise<ResultType<{ readonly extensionId: string; readonly reason: string } | undefined, CodingExtensionError>> {
	for (const extension of extensions) {
		let result: CodingBeforeAgentStartResult | undefined;
		try {
			result = await extension.extension.hooks?.beforeAgentStart?.(extensionRuntime(extension), { prompt });
		} catch (error) {
			return Result.err(extensionHookFailed(extension.id, "before_agent_start", error));
		}
		if (result?.kind === "block") return Result.ok({ extensionId: extension.id, reason: result.reason });
	}
	return Result.ok(undefined);
}

export async function extensionBeforeModelCall(
	extensions: readonly InitializedExtension[],
	messages: readonly AgentMessage[],
): Promise<ResultType<AgentMessage[], CodingExtensionError>> {
	const current = [...structuredClone(messages)] as AgentMessage[];
	for (const extension of extensions) {
		let result: CodingBeforeModelCallResult | undefined;
		try {
			result = await extension.extension.hooks?.beforeModelCall?.(extensionRuntime(extension), {});
		} catch (error) {
			return Result.err(extensionHookFailed(extension.id, "before_model_call", error));
		}
		if (result?.context === undefined) continue;
		if (typeof result.context !== "string" || !result.context.trim() || result.context.length > 8_000) {
			return Result.err(
				extensionContractViolation({
					extensionId: extension.id,
					message: `Extension "${extension.id}" returned invalid model context`,
				}),
			);
		}
		current.push({
			role: "user",
			content: [{ type: "text", text: result.context, synthetic: true }],
			timestamp: Date.now(),
		});
	}
	return Result.ok([...current]);
}

export async function notifyExtensionTurnStart(extensions: readonly InitializedExtension[]): Promise<void> {
	for (const extension of extensions) {
		await notifyObserver(extension, "turn_start", () => extension.extension.hooks?.turnStart?.(extensionRuntime(extension)));
	}
}

export async function notifyExtensionTurnEnd(
	extensions: readonly InitializedExtension[],
	input: CodingTurnEndInput,
): Promise<void> {
	for (const extension of extensions) {
		await notifyObserver(extension, "turn_end", () => extension.extension.hooks?.turnEnd?.(extensionRuntime(extension), input));
		await notifyObserver(extension, "after_model_call", () =>
			extension.extension.hooks?.afterModelCall?.(extensionRuntime(extension), input),
		);
	}
}

export async function notifyExtensionSettled(
	extensions: readonly InitializedExtension[],
	input: CodingAgentSettledInput,
): Promise<void> {
	for (const extension of extensions) {
		await notifyObserver(extension, "agent_settled", () =>
			extension.extension.hooks?.agentSettled?.(extensionRuntime(extension), input),
		);
	}
}

async function notifyAfterToolCall(extension: InitializedExtension, input: CodingAfterToolCallInput): Promise<void> {
	await notifyObserver(extension, "after_tool_call", () =>
		extension.extension.hooks?.afterToolCall?.(extensionRuntime(extension), input),
	);
}

async function invokeExtensionHook(
	extension: InitializedExtension,
	hook: string,
	callback: () => void | Promise<void> | undefined,
): Promise<ResultType<void, CodingExtensionError>> {
	try {
		await callback();
		return Result.ok(undefined);
	} catch (error) {
		return Result.err(extensionHookFailed(extension.id, hook, error));
	}
}

async function notifyObserver(
	extension: InitializedExtension,
	event: string,
	callback: () => void | Promise<void> | undefined,
): Promise<void> {
	try {
		await callback();
	} catch (error) {
		const failure = extensionHookFailed(extension.id, event, error);
		try {
			await extension.reportDiagnostic?.({
				code: failure._tag,
				message: failure.message,
				extensionId: extension.id,
			});
		} catch {
			// Diagnostics are an observer channel too; they must not affect an Agent run.
		}
	}
}

export function assertExtensionCapabilityNames(
	extensions: readonly CodingAgentExtension[],
): ResultType<void, CodingExtensionError> {
	const toolNames = reservedToolNames();
	const skillNames = new Set<string>();
	const extensionIds = new Set<string>();
	for (const extension of extensions) {
		const extensionId = extension.id;
		if (!extensionId || extensionIds.has(extensionId)) return Result.err(extensionCapabilityConflict("id", extensionId));
		extensionIds.add(extensionId);
		for (const tool of extension.tools ?? []) {
			if (!tool.name.trim() || toolNames.has(tool.name)) return Result.err(extensionCapabilityConflict("tool", tool.name));
			toolNames.add(tool.name);
		}
		for (const skill of extension.skills ?? []) {
			if (!skill.name.trim() || skillNames.has(skill.name)) return Result.err(extensionCapabilityConflict("skill", skill.name));
			skillNames.add(skill.name);
		}
	}
	return Result.ok(undefined);
}

function assertCatalogCapabilityNames(
	extensions: readonly CodingAgentExtension[],
	initialized: readonly InitializedExtension[],
): ResultType<void, CodingExtensionError> {
	const toolNames = reservedToolNames();
	for (const extension of extensions) {
		for (const tool of extension.tools ?? []) {
			if (!tool.name.trim() || toolNames.has(tool.name)) return Result.err(extensionCapabilityConflict("tool", tool.name));
			toolNames.add(tool.name);
		}
	}
	for (const extension of initialized) {
		for (const tool of extension.catalogTools) {
			if (!tool.name.trim() || toolNames.has(tool.name)) return Result.err(extensionCapabilityConflict("tool", tool.name));
			toolNames.add(tool.name);
		}
	}
	return Result.ok(undefined);
}

function reservedToolNames(): Set<string> {
	return new Set(["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Skill", "UpdateTodos", "SpawnAgent", "SearchTools"]);
}

function createInitializedExtension(
	extension: CodingAgentExtension<any, any, any>,
): InitializedExtension {
	const permissions = new Map<string, ResolvedExtensionToolPermission>();
	const extensionAuthorizedToolNames: string[] = [];
	const initialized: InitializedExtension = {
		id: extension.id,
		extension,
		tools: [],
		catalogTools: [],
		skills: extension.skills ?? [],
		permissions,
		extensionAuthorizedToolNames,
	};
	initialized.tools.push(...mapExtensionTools(initialized, extension.tools ?? []));
	return initialized;
}

function extensionRuntime(extension: InitializedExtension): CodingExtensionRuntime<any, any, any> {
	if (extension.runtime) return extension.runtime;
	return panic(`Extension "${extension.id}" runtime was requested before activation`);
}

function syncActivationRegistries(
	extensions: readonly InitializedExtension[],
	registries: ExtensionActivationRegistries,
): void {
	if (registries.permissions) extensionPermissions(extensions, registries.permissions);
	if (registries.authorizedToolNames) extensionAuthorizedToolNames(extensions, registries.authorizedToolNames);
}

function mapExtensionTools(
	extension: InitializedExtension,
	definitions: readonly CodingExtensionTool<any, any, any>[],
): AgentTool[] {
	return definitions.map((tool) => {
		const authorization = tool.authorization;
		if (authorization.owner === "core") {
			const permission = authorization.permission;
			extension.permissions.set(tool.name, (call) =>
				typeof permission === "function" ? permission(extensionRuntime(extension), call) : permission,
			);
		} else {
			extension.extensionAuthorizedToolNames.push(tool.name);
		}
		return {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			...(tool.title ? { title: (args: JsonObject) => tool.title!(extensionRuntime(extension), args) } : {}),
			...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
			execute: async (toolCallId, args, signal) => {
				const result = await tool.execute(extensionRuntime(extension), {
					toolCallId,
					args: args as JsonObject,
					signal,
				});
				return { ...result, content: [...result.content] };
			},
		} satisfies AgentTool;
	});
}

async function discoverCatalogTools(
	extension: CodingAgentExtension<any, any, any>,
	runtime: CodingExtensionRuntime<any, any, any>,
): Promise<ResultType<readonly CodingExtensionTool<any, any, any>[], CodingExtensionError>> {
	const seen = new Set<string>();
	const tools: CodingExtensionTool<any, any, any>[] = [];
	for (const catalog of extension.catalogs ?? []) {
		if (!catalog.id.trim() || seen.has(catalog.id)) {
			return Result.err(
				extensionContractViolation({
					extensionId: extension.id,
					catalogId: catalog.id,
					message: `Extension "${extension.id}" declared duplicate or empty catalog "${catalog.id}"`,
				}),
			);
		}
		seen.add(catalog.id);
		let discovered: ResultType<CodingToolCatalogDiscovery<any, any, any>, CodingExtensionOperationFailed>;
		try {
			discovered = await catalog.discover(runtime);
		} catch (cause) {
			return Result.err(
				extensionCatalogDiscoveryFailed(
					extension.id,
					catalog.id,
					extensionOperationFailed(cause, `Extension "${extension.id}" catalog "${catalog.id}" discovery failed`),
				),
			);
		}
		if (discovered.isErr()) {
			return Result.err(extensionCatalogDiscoveryFailed(extension.id, catalog.id, discovered.error));
		}
		tools.push(...discovered.value.tools);
	}
	return Result.ok(tools);
}

async function activateExtension(
	extension: CodingAgentExtension<any, any, any>,
	context: CodingExtensionContext<any, any>,
): Promise<ResultType<unknown, CodingExtensionError>> {
	let result: ResultType<unknown, CodingExtensionOperationFailed> | undefined;
	try {
		result = await extension.lifecycle?.activate?.(context);
	} catch (cause) {
		return Result.err(
			extensionActivationFailed(
				extension.id,
				extensionOperationFailed(cause, `Extension "${extension.id}" activation failed`),
			),
		);
	}
	if (!result) return Result.ok(undefined);
	if (result.isErr()) {
		return Result.err(extensionActivationFailed(extension.id, result.error));
	}
	return Result.ok(result.value);
}

async function extensionContext<TConfig extends JsonObject, TState extends JsonObject>(
	extension: CodingAgentExtension<TConfig, TState>,
	context: Omit<CodingExtensionContext, "configuration" | "sessionState" | "requestApproval">,
	runtime: CodingExtensionRuntimeAdapter | undefined,
	sessionState: CodingExtensionSessionStateAdapter | undefined,
): Promise<ResultType<CodingExtensionContext<TConfig, TState>, CodingExtensionError>> {
	return Result.gen(async function* () {
		const configuration = yield* Result.await(extensionConfiguration(extension, runtime));
		const state = yield* Result.await(extensionSessionState(extension, sessionState));
		return Result.ok({
			...context,
			configuration,
			sessionState: state,
			requestApproval: async (request: CodingExtensionApprovalRequest, signal?: AbortSignal) => {
				const valid = assertExtensionApprovalRequest(extension.id, context.sessionId, request);
				if (valid.isErr()) return valid;
				if (signal?.aborted) {
					return Result.err(
						new CodingExtensionApprovalAborted({
							extensionId: extension.id,
							message: "Extension approval was aborted",
						}),
					);
				}
				const requested = runtime?.requestApproval
					? await runtime.requestApproval(structuredClone(request), signal)
					: Result.ok<CodingExtensionApprovalDecision, CodingExtensionError>("deny");
				if (requested.isErr()) return requested;
				const decision = requested.value;
				if (decision !== "deny" && decision !== "allowOnce" && decision !== "allow") {
					return Result.err(
						extensionContractViolation({
							extensionId: extension.id,
							message: "Extension approval handler returned an invalid decision",
						}),
					);
				}
				if (decision === "allow" && !configuration.persistent) {
					return Result.err(
						new CodingExtensionPersistentApprovalUnavailable({
							extensionId: extension.id,
							message: `Extension "${extension.id}" cannot persist an allow decision`,
						}),
					);
				}
				return Result.ok(decision);
			},
		});
	});
}

async function extensionConfiguration<TConfig extends JsonObject, TState extends JsonObject>(
	extension: CodingAgentExtension<TConfig, TState>,
	runtime: CodingExtensionRuntimeAdapter | undefined,
): Promise<ResultType<CodingExtensionConfigurationStore<TConfig>, CodingExtensionError>> {
	const declaration = extension.configuration;
	if (!declaration) return Result.ok(unavailableConfiguration<TConfig>(extension.id));
	if (!Value.Check(declaration.schema, declaration.defaultValue)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" declared an invalid default configuration`,
			}),
		);
	}
	const loaded = runtime?.readConfiguration
		? await runtime.readConfiguration({ extensionId: extension.id, scope: declaration.scope })
		: Result.ok<JsonObject | undefined, CodingExtensionError>(undefined);
	if (loaded.isErr()) return loaded;
	if (loaded.value !== undefined && !Value.Check(declaration.schema, loaded.value)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" configuration is invalid`,
			}),
		);
	}
	let value = structuredClone((loaded.value ?? declaration.defaultValue) as TConfig);
	const persistent = Boolean(runtime?.writeConfiguration);
	return Result.ok({
		get value() {
			return structuredClone(value);
		},
		persistent,
		async update(next) {
			if (!runtime?.writeConfiguration) {
				return Result.err(
					new CodingExtensionConfigurationUnavailable({
						extensionId: extension.id,
						message: `Extension "${extension.id}" configuration cannot be persisted by this host`,
					}),
				);
			}
			if (!Value.Check(declaration.schema, next)) {
				return Result.err(
					extensionContractViolation({
						extensionId: extension.id,
						message: `Extension "${extension.id}" attempted to persist invalid configuration`,
					}),
				);
			}
			const persisted = await runtime.writeConfiguration({
				extensionId: extension.id,
				scope: declaration.scope,
				value: structuredClone(next),
			});
			if (persisted.isErr()) return persisted;
			if (!Value.Check(declaration.schema, persisted.value)) {
				return Result.err(
					extensionContractViolation({
						extensionId: extension.id,
						message: `Host persisted invalid configuration for extension "${extension.id}"`,
					}),
				);
			}
			value = structuredClone(persisted.value as TConfig);
			return Result.ok(structuredClone(value));
		},
	});
}

async function extensionSessionState<TConfig extends JsonObject, TState extends JsonObject>(
	extension: CodingAgentExtension<TConfig, TState>,
	adapter: CodingExtensionSessionStateAdapter | undefined,
): Promise<ResultType<CodingExtensionSessionStateStore<TState>, CodingExtensionError>> {
	const declaration = extension.sessionState;
	if (!declaration) return Result.ok(unavailableSessionState<TState>(extension.id));
	if (!Value.Check(declaration.schema, declaration.defaultValue)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" declared invalid default session state`,
			}),
		);
	}
	if (!adapter) {
		return Result.err(
			new CodingExtensionSessionStateUnavailable({
				extensionId: extension.id,
				message: `Extension "${extension.id}" session state is unavailable`,
			}),
		);
	}
	const loaded = await adapter.read(extension.id);
	if (loaded.isErr()) return loaded;
	if (loaded.value !== undefined && !Value.Check(declaration.schema, loaded.value)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" session state is invalid`,
			}),
		);
	}
	let value = structuredClone((loaded.value ?? declaration.defaultValue) as TState);
	return Result.ok({
		get value() {
			return structuredClone(value);
		},
		async update(update) {
			const persisted = await adapter.update(extension.id, (stored) => {
				const current = structuredClone((stored ?? declaration.defaultValue) as TState);
				if (!Value.Check(declaration.schema, current)) {
					return Result.err(
						extensionContractViolation({
							extensionId: extension.id,
							message: `Extension "${extension.id}" session state is invalid`,
						}),
					);
				}
				const next = update(current);
				if (!Value.Check(declaration.schema, next)) {
					return Result.err(
						extensionContractViolation({
							extensionId: extension.id,
							message: `Extension "${extension.id}" attempted to persist invalid session state`,
						}),
					);
				}
				return Result.ok(structuredClone(next));
			});
			if (persisted.isErr()) return persisted;
			if (!Value.Check(declaration.schema, persisted.value)) {
				return Result.err(
					extensionContractViolation({
						extensionId: extension.id,
						message: `Host persisted invalid session state for extension "${extension.id}"`,
					}),
				);
			}
			value = structuredClone(persisted.value as TState);
			return Result.ok(structuredClone(value));
		},
	});
}

function unavailableConfiguration<TConfig extends JsonObject>(
	extensionId: string,
): CodingExtensionConfigurationStore<TConfig> {
	return {
		value: {} as TConfig,
		persistent: false,
		update: async () =>
			Result.err(
				new CodingExtensionConfigurationUnavailable({
					extensionId,
					message: `Extension "${extensionId}" did not declare persistent configuration`,
				}),
			),
	};
}

function unavailableSessionState<TState extends JsonObject>(
	extensionId: string,
): CodingExtensionSessionStateStore<TState> {
	return {
		value: {} as TState,
		update: async () =>
			Result.err(
				new CodingExtensionSessionStateUnavailable({
					extensionId,
					message: `Extension "${extensionId}" did not declare session state`,
				}),
			),
	};
}

function assertExtensionApprovalRequest(
	extensionId: string,
	sessionId: string,
	request: CodingExtensionApprovalRequest,
): ResultType<void, CodingExtensionError> {
	if (
		request.extensionId !== extensionId ||
		request.sessionId !== sessionId ||
		!request.requestId.trim() ||
		!request.operationId.trim() ||
		!request.reason.trim() ||
		!request.presentation.title.trim()
	) {
		return Result.err(
			extensionContractViolation({
				extensionId,
				message: `Extension "${extensionId}" produced an invalid approval request`,
			}),
		);
	}
	return Result.ok(undefined);
}
