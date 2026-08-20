import type { AgentTool, ToolMiddleware } from "@jai/agent";
import { validateToolArguments } from "@jai/ai";
import type { TObject, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CodingSdkFailure } from "./project";
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
	update(next: TConfig): Promise<TConfig>;
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
	}): JsonObject | undefined | Promise<JsonObject | undefined>;
	writeConfiguration?(input: {
		readonly extensionId: string;
		readonly scope: "user" | "project";
		readonly value: JsonObject;
	}): JsonObject | Promise<JsonObject>;
	requestApproval?(
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	): CodingExtensionApprovalDecision | Promise<CodingExtensionApprovalDecision>;
}

export interface CodingExtensionContext<TConfig extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly cwd: string;
	readonly permissionMode: CodingPermissionMode;
	readonly configuration: CodingExtensionConfigurationStore<TConfig>;
	requestApproval(
		request: CodingExtensionApprovalRequest,
		signal?: AbortSignal,
	): Promise<CodingExtensionApprovalDecision>;
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

export interface CodingExtensionTool<TParameters extends TSchema = TSchema> {
	readonly name: string;
	readonly description: string;
	readonly parameters: TParameters;
	readonly authorization:
		| { readonly owner: "core"; readonly permission: CodingToolPermission | CodingExtensionToolPermissionResolver }
		| { readonly owner: "extension" };
	readonly execute: (
		call: CodingExtensionToolCall<JsonObject>,
	) => CodingExtensionToolResult | Promise<CodingExtensionToolResult>;
	readonly title?: (args: JsonObject) => string;
	readonly executionMode?: "sequential" | "parallel";
}

export type CodingExtensionToolPermissionResolver = (
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

export interface CodingExtensionHooks {
	readonly sessionStart?: (context: CodingExtensionContext) => void | Promise<void>;
	readonly beforeToolCall?: (
		input: CodingBeforeToolCallInput,
	) => CodingBeforeToolCallResult | undefined | Promise<CodingBeforeToolCallResult | undefined>;
	readonly afterToolCall?: (input: CodingAfterToolCallInput) => void | Promise<void>;
}

export interface CodingExtensionCapabilities {
	readonly tools?: readonly CodingExtensionTool[];
	readonly skills?: readonly CodingExtensionSkill[];
	readonly hooks?: CodingExtensionHooks;
	readonly dispose?: () => void | Promise<void>;
}

export interface CodingAgentExtension<TConfig extends JsonObject = JsonObject> {
	readonly id: string;
	readonly configuration?: CodingExtensionConfiguration<TConfig>;
	initialize(
		context: CodingExtensionContext<TConfig>,
	): CodingExtensionCapabilities | Promise<CodingExtensionCapabilities>;
}

export function defineExtension<TConfig extends JsonObject = JsonObject>(
	extension: CodingAgentExtension<TConfig>,
): CodingAgentExtension<TConfig> {
	return extension;
}

interface InitializedExtension {
	readonly id: string;
	readonly context: CodingExtensionContext;
	readonly capabilities: CodingExtensionCapabilities;
	readonly tools: readonly AgentTool[];
	readonly skills: readonly CodingExtensionSkill[];
	readonly permissions: ReadonlyMap<string, CodingExtensionToolPermissionResolver>;
	readonly extensionAuthorizedToolNames: readonly string[];
}

export async function initializeExtensions(
	extensions: readonly CodingAgentExtension[],
	context: Omit<CodingExtensionContext, "configuration" | "requestApproval">,
	runtime?: CodingExtensionRuntimeAdapter,
): Promise<readonly InitializedExtension[]> {
	const initialized: InitializedExtension[] = [];
	try {
		assertExtensionIds(extensions);
		for (const extension of extensions) {
			const initializedContext = await extensionContext(extension, context, runtime);
			const capabilities = await extension.initialize(initializedContext);
			const current = createInitializedExtension(extension.id, initializedContext, capabilities);
			initialized.push(current);
		}
		assertExtensionCapabilityNames(initialized);
		for (const extension of initialized) await extension.capabilities.hooks?.sessionStart?.(extension.context);
		return initialized;
	} catch (error) {
		await disposeExtensions(initialized);
		throw error;
	}
}

function assertExtensionIds(extensions: readonly CodingAgentExtension[]): void {
	const extensionIds = new Set<string>();
	for (const extension of extensions) {
		const id = extension.id.trim();
		if (!id || extensionIds.has(id)) throw duplicateCapabilityFailure("id", extension.id);
		extensionIds.add(id);
	}
}

export async function disposeExtensions(extensions: readonly InitializedExtension[]): Promise<void> {
	let failure: unknown;
	for (const extension of [...extensions].reverse()) {
		try {
			await extension.capabilities.dispose?.();
		} catch (error) {
			failure ??= error;
		}
	}
	if (failure) throw failure;
}

export function extensionTools(extensions: readonly InitializedExtension[]): readonly AgentTool[] {
	return extensions.flatMap((extension) => extension.tools);
}

export function extensionSkills(extensions: readonly InitializedExtension[]): readonly CodingExtensionSkill[] {
	return extensions.flatMap((extension) => extension.skills);
}

export function extensionPermissions(
	extensions: readonly InitializedExtension[],
): ReadonlyMap<string, CodingExtensionToolPermissionResolver> {
	return new Map(extensions.flatMap((extension) => [...extension.permissions]));
}

export function extensionAuthorizedToolNames(extensions: readonly InitializedExtension[]): ReadonlySet<string> {
	return new Set(extensions.flatMap((extension) => extension.extensionAuthorizedToolNames));
}

export function extensionMiddleware(extensions: readonly InitializedExtension[]): ToolMiddleware {
	return async (context, next) => {
		let args = context.args as JsonObject;
		for (const extension of extensions) {
			const result = await extension.capabilities.hooks?.beforeToolCall?.({
				toolCallId: context.toolCall.id,
				toolName: context.tool.name,
				args: structuredClone(args),
			});
			if (result?.kind === "block") return { content: [{ type: "text", text: result.reason }] };
			if (result?.kind === "continue" && result.args) args = result.args;
		}
		const validation = validateToolArguments(context.tool, { ...context.toolCall, arguments: args });
		if (validation.isErr()) {
			throw new CodingSdkFailure({
				phase: "tool",
				code: "coding_sdk.extension_invalid_tool_arguments",
				message: validation.error.message,
			});
		}
		context.args = validation.value as Record<string, unknown>;
		try {
			const result = await next();
			for (const extension of extensions) {
				await extension.capabilities.hooks?.afterToolCall?.({
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
				await extension.capabilities.hooks?.afterToolCall?.({
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

export function assertExtensionCapabilityNames(extensions: readonly InitializedExtension[]): void {
	const toolNames = new Set(["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Skill", "UpdateTodos", "SpawnAgent"]);
	const skillNames = new Set<string>();
	const extensionIds = new Set<string>();
	for (const extension of extensions) {
		const extensionId = extension.id;
		if (!extensionId || extensionIds.has(extensionId)) throw duplicateCapabilityFailure("id", extensionId);
		extensionIds.add(extensionId);
		for (const tool of extension.capabilities.tools ?? []) {
			if (!tool.name.trim() || toolNames.has(tool.name)) throw duplicateCapabilityFailure("tool", tool.name);
			toolNames.add(tool.name);
		}
		for (const skill of extension.capabilities.skills ?? []) {
			if (!skill.name.trim() || skillNames.has(skill.name)) throw duplicateCapabilityFailure("skill", skill.name);
			skillNames.add(skill.name);
		}
	}
}

function createInitializedExtension(
	id: string,
	context: CodingExtensionContext,
	capabilities: CodingExtensionCapabilities,
): InitializedExtension {
	const permissions = new Map<string, CodingExtensionToolPermissionResolver>();
	const extensionAuthorizedToolNames: string[] = [];
	const tools = (capabilities.tools ?? []).map((tool) => {
		const authorization = tool.authorization;
		if (authorization.owner === "core") {
			const permission = authorization.permission;
			permissions.set(tool.name, (call) => (typeof permission === "function" ? permission(call) : permission));
		} else extensionAuthorizedToolNames.push(tool.name);
		return {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			...(tool.title ? { title: tool.title as AgentTool["title"] } : {}),
			...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
			execute: async (toolCallId, args, signal) => {
				const result = await tool.execute({ toolCallId, args: args as JsonObject, signal });
				return { ...result, content: [...result.content] };
			},
		} satisfies AgentTool;
	});
	return {
		id,
		context,
		capabilities,
		tools,
		skills: capabilities.skills ?? [],
		permissions,
		extensionAuthorizedToolNames,
	};
}

async function extensionContext<TConfig extends JsonObject>(
	extension: CodingAgentExtension<TConfig>,
	context: Omit<CodingExtensionContext, "configuration" | "requestApproval">,
	runtime: CodingExtensionRuntimeAdapter | undefined,
): Promise<CodingExtensionContext<TConfig>> {
	const configuration = await extensionConfiguration(extension, runtime);
	return {
		...context,
		configuration,
		requestApproval: async (request, signal) => {
			assertExtensionApprovalRequest(extension.id, context.sessionId, request);
			if (signal?.aborted)
				throw extensionRuntimeFailure("extension_approval_aborted", "Extension approval was aborted");
			const decision = (await runtime?.requestApproval?.(structuredClone(request), signal)) ?? "deny";
			if (decision !== "deny" && decision !== "allowOnce" && decision !== "allow") {
				throw extensionRuntimeFailure(
					"extension_invalid_approval_decision",
					"Extension approval handler returned an invalid decision",
				);
			}
			if (decision === "allow" && !configuration.persistent) {
				throw extensionRuntimeFailure(
					"extension_persistent_approval_unavailable",
					`Extension "${extension.id}" cannot persist an allow decision`,
				);
			}
			return decision;
		},
	};
}

async function extensionConfiguration<TConfig extends JsonObject>(
	extension: CodingAgentExtension<TConfig>,
	runtime: CodingExtensionRuntimeAdapter | undefined,
): Promise<CodingExtensionConfigurationStore<TConfig>> {
	const declaration = extension.configuration;
	if (!declaration) return unavailableConfiguration<TConfig>(extension.id);
	if (!Value.Check(declaration.schema, declaration.defaultValue)) {
		throw extensionRuntimeFailure(
			"extension_configuration_default_invalid",
			`Extension "${extension.id}" declared an invalid default configuration`,
		);
	}
	const loaded = await runtime?.readConfiguration?.({ extensionId: extension.id, scope: declaration.scope });
	if (loaded !== undefined && !Value.Check(declaration.schema, loaded)) {
		throw extensionRuntimeFailure(
			"extension_configuration_invalid",
			`Extension "${extension.id}" configuration is invalid`,
		);
	}
	let value = structuredClone((loaded ?? declaration.defaultValue) as TConfig);
	const persistent = Boolean(runtime?.writeConfiguration);
	return {
		get value() {
			return structuredClone(value);
		},
		persistent,
		async update(next) {
			if (!runtime?.writeConfiguration) {
				throw extensionRuntimeFailure(
					"extension_configuration_unavailable",
					`Extension "${extension.id}" configuration cannot be persisted by this host`,
				);
			}
			if (!Value.Check(declaration.schema, next)) {
				throw extensionRuntimeFailure(
					"extension_configuration_invalid",
					`Extension "${extension.id}" attempted to persist invalid configuration`,
				);
			}
			const persisted = await runtime.writeConfiguration({
				extensionId: extension.id,
				scope: declaration.scope,
				value: structuredClone(next),
			});
			if (!Value.Check(declaration.schema, persisted)) {
				throw extensionRuntimeFailure(
					"extension_configuration_invalid",
					`Host persisted invalid configuration for extension "${extension.id}"`,
				);
			}
			value = structuredClone(persisted as TConfig);
			return structuredClone(value);
		},
	};
}

function unavailableConfiguration<TConfig extends JsonObject>(
	extensionId: string,
): CodingExtensionConfigurationStore<TConfig> {
	return {
		value: {} as TConfig,
		persistent: false,
		update: async () => {
			throw extensionRuntimeFailure(
				"extension_configuration_unavailable",
				`Extension "${extensionId}" did not declare persistent configuration`,
			);
		},
	};
}

function assertExtensionApprovalRequest(
	extensionId: string,
	sessionId: string,
	request: CodingExtensionApprovalRequest,
): void {
	if (
		request.extensionId !== extensionId ||
		request.sessionId !== sessionId ||
		!request.requestId.trim() ||
		!request.operationId.trim() ||
		!request.reason.trim() ||
		!request.presentation.title.trim()
	) {
		throw extensionRuntimeFailure(
			"extension_invalid_approval_request",
			`Extension "${extensionId}" produced an invalid approval request`,
		);
	}
}

function extensionRuntimeFailure(code: string, message: string): CodingSdkFailure {
	return new CodingSdkFailure({ phase: "permission", code: `coding_sdk.${code}`, message });
}

function duplicateCapabilityFailure(kind: string, name: string): CodingSdkFailure {
	return new CodingSdkFailure({
		phase: "runtime_creation",
		code: "coding_sdk.extension_capability_conflict",
		message: `Extension ${kind} "${name}" conflicts with an existing capability`,
	});
}
