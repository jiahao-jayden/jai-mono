import type { AgentMessage, AgentTool, ToolMiddleware } from "@jai/agent";
import { validateToolArguments } from "@jai/ai";
import { panic, Result, type Result as ResultType } from "better-result";
import type { JsonObject } from "../core/json";
import type { CodingToolPresentation } from "./tool-presentation";
import {
	CodingExtensionDeactivationFailed,
	type CodingExtensionError,
	type CodingExtensionOperationFailed,
	CodingExtensionPolicyBlocked,
	extensionActivationFailed,
	extensionCapabilityConflict,
	extensionCatalogDiscoveryFailed,
	extensionContractViolation,
	extensionHookFailed,
	extensionOperationFailed,
} from "./extension-errors";
import type {
	CodingAfterToolCallInput,
	CodingAgentExtension,
	CodingAgentSettledInput,
	CodingBeforeAgentStartResult,
	CodingBeforeModelCallResult,
	CodingBeforeToolCallResult,
	CodingExtensionContext,
	CodingExtensionDiagnostic,
	CodingExtensionRuntime,
	CodingExtensionRuntimeAdapter,
	CodingExtensionSessionStateAdapter,
	CodingExtensionSkill,
	CodingExtensionTool,
	CodingExtensionToolPresentation,
	CodingExtensionToolCall,
	CodingExtensionToolResult,
	CodingToolCatalogDiscovery,
	CodingToolPermission,
	CodingTurnEndInput,
} from "./extensions/contract";
import { extensionContext } from "./extensions/host-adapters";

export type {
	CodingAfterToolCallInput,
	CodingAgentExtension,
	CodingAgentSettledInput,
	CodingBeforeAgentStartInput,
	CodingBeforeAgentStartResult,
	CodingBeforeModelCallInput,
	CodingBeforeModelCallResult,
	CodingBeforeToolCallInput,
	CodingBeforeToolCallResult,
	CodingExtensionApprovalDecision,
	CodingExtensionApprovalPresentation,
	CodingExtensionApprovalRequest,
	CodingExtensionConfiguration,
	CodingExtensionConfigurationStore,
	CodingExtensionContext,
	CodingExtensionDiagnostic,
	CodingExtensionHooks,
	CodingExtensionLifecycle,
	CodingExtensionRuntime,
	CodingExtensionRuntimeAdapter,
	CodingExtensionSessionState,
	CodingExtensionSessionStateAdapter,
	CodingExtensionSessionStateStore,
	CodingExtensionSkill,
	CodingExtensionTool,
	CodingExtensionToolPresentation,
	CodingExtensionToolCall,
	CodingExtensionToolCatalog,
	CodingExtensionToolPermissionResolver,
	CodingExtensionToolResult,
	CodingToolCatalogDiscovery,
	CodingToolPermission,
	CodingTurnEndInput,
} from "./extensions/contract";

export function defineExtension<T extends CodingAgentExtension<any, any, any>>(extension: T): T {
	return extension;
}

export interface InitializedExtension {
	readonly id: string;
	readonly extension: CodingAgentExtension<any, any, any>;
	runtime?: CodingExtensionRuntime<any, any, any>;
	readonly tools: AgentTool[];
	readonly catalogTools: AgentTool[];
	readonly toolPresentations: Map<string, CodingToolPresentation>;
	readonly skills: readonly CodingExtensionSkill[];
	readonly permissions: Map<string, ResolvedExtensionToolPermission>;
	readonly extensionAuthorizedToolNames: string[];
	reportDiagnostic?: (diagnostic: CodingExtensionDiagnostic) => void | Promise<void>;
}

type ResolvedExtensionToolPermission = (
	call: CodingExtensionToolCall<JsonObject>,
) => CodingToolPermission | Promise<CodingToolPermission>;

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

export function extensionToolPresentations(
	extensions: readonly InitializedExtension[],
): ReadonlyMap<string, CodingToolPresentation> {
	return new Map(extensions.flatMap((extension) => [...extension.toolPresentations]));
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
			// Thrown rather than returned: the agent loop turns a middleware throw into an `isError`
			// tool result, so the model reads the block as a refusal instead of a successful call.
			if (result?.kind === "block") {
				throw new CodingExtensionPolicyBlocked({
					extensionId: extension.id,
					hook: "before_tool_call",
					reason: result.reason,
					message: result.reason,
				});
			}
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
	// Shallow copy: Extensions only append synthetic context here (they receive no messages and cannot
	// reach the existing ones), so deep-cloning the whole transcript on every model call buys nothing.
	const current = [...messages] as AgentMessage[];
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
		await notifyObserver(extension, "turn_start", () =>
			extension.extension.hooks?.turnStart?.(extensionRuntime(extension)),
		);
	}
}

export async function notifyExtensionTurnEnd(
	extensions: readonly InitializedExtension[],
	input: CodingTurnEndInput,
): Promise<void> {
	for (const extension of extensions) {
		await notifyObserver(extension, "turn_end", () =>
			extension.extension.hooks?.turnEnd?.(extensionRuntime(extension), input),
		);
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
		if (!extensionId || extensionIds.has(extensionId))
			return Result.err(extensionCapabilityConflict("id", extensionId));
		extensionIds.add(extensionId);
		for (const tool of extension.tools ?? []) {
			if (!tool.name.trim() || toolNames.has(tool.name))
				return Result.err(extensionCapabilityConflict("tool", tool.name));
			toolNames.add(tool.name);
		}
		for (const skill of extension.skills ?? []) {
			if (!skill.name.trim() || skillNames.has(skill.name))
				return Result.err(extensionCapabilityConflict("skill", skill.name));
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
			if (!tool.name.trim() || toolNames.has(tool.name))
				return Result.err(extensionCapabilityConflict("tool", tool.name));
			toolNames.add(tool.name);
		}
	}
	for (const extension of initialized) {
		for (const tool of extension.catalogTools) {
			if (!tool.name.trim() || toolNames.has(tool.name))
				return Result.err(extensionCapabilityConflict("tool", tool.name));
			toolNames.add(tool.name);
		}
	}
	return Result.ok(undefined);
}

function reservedToolNames(): Set<string> {
	return new Set([
		"Read",
		"Write",
		"Edit",
		"Glob",
		"Grep",
		"Bash",
		"Skill",
		"UpdateTodos",
		"SpawnAgent",
		"SearchTools",
	]);
}

function createInitializedExtension(extension: CodingAgentExtension<any, any, any>): InitializedExtension {
	const permissions = new Map<string, ResolvedExtensionToolPermission>();
	const extensionAuthorizedToolNames: string[] = [];
	const initialized: InitializedExtension = {
		id: extension.id,
		extension,
		tools: [],
		catalogTools: [],
		toolPresentations: new Map(),
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
		const presentation = tool.presentation;
		if (presentation) {
			extension.toolPresentations.set(tool.name, {
				...(presentation.activityKind ? { activityKind: presentation.activityKind } : {}),
				...(presentation.title
					? { title: (args) => presentation.title!(extensionRuntime(extension), args as JsonObject) }
					: {}),
				...(presentation.resolveActivityKind
					? {
							resolveActivityKind: (args) =>
								presentation.resolveActivityKind!(extensionRuntime(extension), args as JsonObject),
						}
					: {}),
			});
		}
		return {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
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
