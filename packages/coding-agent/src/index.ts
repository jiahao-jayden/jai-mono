import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { AgentEvent, AgentMessage } from "@jai/agent";
import { FileSessionStore } from "@jai/agent/node";
import type { AssistantMessage, AssistantMessageEvent, Message, Model, Provider, ToolResultMessage } from "@jai/ai";
import type { CodingMessageAttachment as InternalCodingAttachment } from "@jai/coding";
import type { AgentPluginDirectory } from "@jai/coding/agent-plugins";
import type { ConnectorApprovalRequest as InternalConnectorApprovalRequest } from "@jai/coding/connector";
import type { PermissionMode, PermissionSettings } from "@jai/coding/permissions";
import {
	type CodingAgentSettings,
	codingAgentConfigDefinition,
	createCodingAgent as createInternalCodingAgent,
	DEFAULT_CODING_AGENT_INSTRUCTIONS,
	type CodingAgent as InternalCodingAgent,
	resolveConfiguredAgentRuntime,
	resolveConfiguredMcpServers,
	resolveConfiguredProvider,
} from "@jai/coding/runtime";
import type { ConnectorService } from "@jai/connector";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { CodingPluginDirectory } from "./plugin-directories";

export {
	type CodingAgentPluginDirectoryDiscoveryOptions,
	type CodingPluginDirectory,
	discoverCodingAgentPluginDirectories,
} from "./plugin-directories";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };
export type CodingAgentMessage = Message;
export type CodingAssistantMessage = AssistantMessage;
export type CodingToolResult = ToolResultMessage;

export type CodingPermissionMode = PermissionMode;
export type CodingToolName =
	| "Bash"
	| "Edit"
	| "Glob"
	| "Grep"
	| "Read"
	| "Skill"
	| "SpawnAgent"
	| "UpdateTodos"
	| "Write";

export const codingAgentToolNames = {
	spawnAgent: "SpawnAgent",
	updateTodos: "UpdateTodos",
} as const;

export type CodingSdkErrorPhase =
	| "runtime_creation"
	| "session"
	| "admission"
	| "model"
	| "tool"
	| "permission"
	| "compaction"
	| "lifecycle";

export interface CodingSdkError {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly phase: CodingSdkErrorPhase;
	readonly requestId?: string;
	readonly toolCallId?: string;
	readonly details?: JsonValue;
}

export type SessionSelection =
	| { readonly kind: "new"; readonly id?: string; readonly persistence: "durable" }
	| { readonly kind: "resume"; readonly id: string }
	| { readonly kind: "ephemeral" };

export interface CodingAgentExecutionConfiguration {
	readonly model?: string;
	readonly permissionMode?: CodingPermissionMode;
	readonly maxTurns?: number;
	readonly instructions?: string;
	readonly compactionSummaryInstructions?: string;
}

export interface CodingModelResolution {
	/** The host returns the @jai/ai Model object without making it part of the SDK contract. */
	readonly model: unknown;
	/** The host returns the @jai/ai Provider object without making it part of the SDK contract. */
	readonly provider: unknown;
}

export interface CodingModelAuthority {
	resolve(input: {
		readonly model?: string;
		readonly settings: unknown;
		readonly signal?: AbortSignal;
	}): Promise<CodingModelResolution> | CodingModelResolution;
}

export interface ConfiguredModelAuthorityOptions {
	/** Opaque Models.dev catalog supplied by a host that has already loaded it. */
	readonly catalog?: unknown;
	/** Provider inventory from the host's last explicit model discovery. */
	readonly availableModelIds?: readonly string[];
	/** Require verified capabilities before an Agent can start. */
	readonly requireVerifiedCapabilities?: boolean;
}

/**
 * The standard authority for hosts that use Jai's ordinary user/project configuration.
 * Provider resolution remains inside the SDK; hosts only supply optional catalog facts.
 */
export function createConfiguredModelAuthority(options: ConfiguredModelAuthorityOptions = {}): CodingModelAuthority {
	return {
		resolve({ model, settings }) {
			return resolveConfiguredProvider(settings as CodingAgentSettings, model, options.catalog as never, {
				...(options.availableModelIds ? { availableModelIds: options.availableModelIds } : {}),
				requireVerifiedCapabilities: options.requireVerifiedCapabilities ?? false,
			});
		},
	};
}

export const configuredModelAuthority: CodingModelAuthority = createConfiguredModelAuthority();

export interface CodingWorkspaceAuthority {
	readonly cwd: string;
	readonly configRoot?: string;
	readonly defaultAllowedDirectories?: readonly string[];
	readonly localFileAccess?: boolean;
	readonly shellPath?: string;
	readonly ripgrepPath?: string;
	readonly trusted?: boolean;
}

export interface CodingSessionStorageAuthority {
	readonly directory: string;
}

export interface CodingAttachment {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sourcePath: string;
	readonly image?: () => Promise<unknown>;
}

export interface CodingCapabilitySources {
	readonly plugins?: {
		readonly directories: readonly (string | CodingPluginDirectory)[];
		readonly dataDirectory?: string;
		readonly scope?: "user" | "project";
	};
}

export interface CodingPermissionRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: CodingToolName;
	readonly args: Readonly<Record<string, JsonValue>>;
	readonly reason: string;
	readonly canAlwaysAllow: boolean;
	readonly suggestedRule?: string;
	readonly suggestedRules?: readonly string[];
	readonly rememberScope?: "session" | "project-local";
}

export type CodingPermissionDecision = "deny" | "allowOnce" | "alwaysAllow";

export interface CodingApprovalAuthority {
	request(
		request: CodingPermissionRequest,
		signal?: AbortSignal,
	): CodingPermissionDecision | Promise<CodingPermissionDecision>;
}

export interface CodingConnectorApprovalRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: "connector__execute_action";
	readonly actionId: string;
	readonly reason: string;
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity: "normal" | "sensitive" | "secret";
	readonly inputKeys: readonly string[];
	readonly expiresAt: number;
}

export type CodingConnectorApprovalDecision = "deny" | "allowOnce" | "alwaysAllow";

export interface CodingConnectorAuthority {
	readonly client?: unknown;
	readonly resolve?: (input: {
		readonly settings: unknown;
		readonly signal?: AbortSignal;
	}) =>
		| unknown
		| { readonly client: unknown; readonly close?: () => void | Promise<void> }
		| undefined
		| Promise<unknown | { readonly client: unknown; readonly close?: () => void | Promise<void> } | undefined>;
	readonly requestApproval?: (
		request: CodingConnectorApprovalRequest,
		signal?: AbortSignal,
	) => CodingConnectorApprovalDecision | Promise<CodingConnectorApprovalDecision>;
}

export interface CodingConfigurationAuthority {
	readonly homeDirectory?: string;
	readonly workspaceTrusted?: boolean;
}

export interface CodingAgentHost {
	readonly model: CodingModelAuthority;
	readonly workspace: CodingWorkspaceAuthority;
	readonly session: CodingSessionStorageAuthority;
	readonly approval?: CodingApprovalAuthority;
	readonly configuration?: CodingConfigurationAuthority;
	readonly capabilitySources?: CodingCapabilitySources;
	readonly connector?: CodingConnectorAuthority;
	readonly diagnostics?: (diagnostic: CodingSdkDiagnostic) => void;
}

export interface CodingSdkDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly source: "host" | "sdk";
}

export interface CodingAgentCreateInput {
	readonly host: CodingAgentHost;
	readonly session: SessionSelection;
	readonly execution?: CodingAgentExecutionConfiguration;
}

export interface CodingPrompt {
	readonly prompt: string;
	readonly attachments?: readonly CodingAttachment[];
	readonly delivery?: "steer" | "queue";
}

export interface CodingRunResult<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly messages: readonly CodingAgentMessage[];
	readonly state: CodingAgentState<TAppState>;
}

export interface CodingSessionTitleInput {
	readonly firstMessage: string;
}

export type CodingAgentEvent =
	| { readonly type: "agent_start" }
	| { readonly type: "agent_end"; readonly messages: readonly CodingAgentMessage[] }
	| { readonly type: "turn_start" }
	| {
			readonly type: "turn_end";
			readonly message: CodingAssistantMessage;
			readonly toolResults: readonly CodingToolResult[];
	  }
	| { readonly type: "message_start"; readonly message: CodingAgentMessage }
	| {
			readonly type: "message_update";
			readonly message: CodingAssistantMessage;
			readonly assistantEvent: AssistantMessageEvent;
	  }
	| { readonly type: "message_end"; readonly message: CodingAgentMessage }
	| {
			readonly type: "tool_execution_start";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly title: string;
			readonly args: JsonValue;
	  }
	| {
			readonly type: "tool_execution_update";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly partial: JsonValue;
	  }
	| {
			readonly type: "tool_execution_end";
			readonly toolCallId: string;
			readonly toolName: string;
			readonly result: JsonValue;
			readonly isError: boolean;
	  }
	| { readonly type: "compaction_start"; readonly trigger: string; readonly tokensBefore: number }
	| { readonly type: "compaction_end"; readonly outcome: JsonValue };

export interface CodingAgentTodo {
	readonly id: string;
	readonly content: string;
	readonly status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface CodingAgentArtifact {
	readonly id: string;
	readonly toolCallId: string;
	readonly path: string;
	readonly format: "markdown" | "html";
	readonly updatedAt: number;
}

export interface CodingAgentState<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly status: "idle" | "running" | "aborted" | "closed";
	readonly messages: readonly CodingAgentMessage[];
	readonly todos: readonly CodingAgentTodo[];
	readonly artifacts: readonly CodingAgentArtifact[];
	readonly appState: TAppState;
	readonly error?: JsonObject;
}

export interface CodingAgent<TAppState extends JsonObject = JsonObject> {
	readonly sessionId: string;
	readonly execution: CodingAgentExecutionConfiguration;
	readonly state: CodingAgentState<TAppState>;
	prompt(input: CodingPrompt): Promise<ResultType<CodingRunResult<TAppState>, CodingSdkError>>;
	steer(input: CodingPrompt): Promise<ResultType<void, CodingSdkError>>;
	followUp(input: CodingPrompt): Promise<ResultType<void, CodingSdkError>>;
	waitForIdle(): Promise<ResultType<void, CodingSdkError>>;
	generateTitle(input: CodingSessionTitleInput): Promise<ResultType<string, CodingSdkError>>;
	abort(): Promise<ResultType<void, CodingSdkError>>;
	subscribe(listener: (event: CodingAgentEvent) => void): () => void;
	close(): Promise<ResultType<void, CodingSdkError>>;
}

export async function createCodingAgent<TAppState extends JsonObject = JsonObject>(
	input: CodingAgentCreateInput,
): Promise<ResultType<CodingAgent<TAppState>, CodingSdkError>> {
	if (input.execution?.permissionMode === "plan") {
		return Result.err({
			code: "coding_sdk.permission_mode_unsupported",
			message: "The plan permission mode is declared but not implemented in this milestone",
			retryable: false,
			phase: "runtime_creation",
		});
	}
	let ephemeralDirectory: string | undefined;
	let modelRuntime: { readonly model: Model; readonly provider: Provider } | undefined;
	try {
		const execution = input.execution ?? {};
		const sessionId = resolveSessionId(input.session);
		const sessionDirectory = await resolveSessionDirectory(input, sessionId, (value) => {
			ephemeralDirectory = value;
		});
		const store = new FileSessionStore<TAppState>(sessionDirectory);
		await validateSessionSelection(input.session, store, sessionId);
		const internal = await createInternalCodingAgent<TSchema, TAppState>({
			executionContext: {
				localFileAccess: input.host.workspace.localFileAccess ?? true,
				cwd: input.host.workspace.cwd,
				configRoot: input.host.workspace.configRoot ?? input.host.workspace.cwd,
				defaultAllowedDirectories: (input.host.workspace.defaultAllowedDirectories ?? [
					input.host.workspace.cwd,
				]) as readonly [string, ...string[]],
			},
			sessionId,
			sessionDirectory,
			instructions: [DEFAULT_CODING_AGENT_INSTRUCTIONS, execution.instructions].filter(Boolean).join("\n\n"),
			configDefinition: codingAgentConfigDefinition,
			configOptions: {
				homeDir: input.host.configuration?.homeDirectory ?? homedir(),
				workspaceTrusted: input.host.configuration?.workspaceTrusted ?? input.host.workspace.trusted ?? false,
			},
			resolveProvider: (snapshot) =>
				Promise.resolve(input.host.model.resolve({ model: execution.model, settings: snapshot.settings })).then(
					(resolved) => {
						const runtime = { model: resolved.model as Model, provider: resolved.provider as Provider };
						modelRuntime = runtime;
						return runtime;
					},
				),
			resolveMcpServers: (snapshot) => resolveConfiguredMcpServers(snapshot.settings as CodingAgentSettings),
			resolveAgentOptions: (snapshot, resolved) => {
				const runtime = resolveConfiguredAgentRuntime(snapshot.settings as CodingAgentSettings, resolved);
				return {
					maxIterations: execution.maxTurns ?? runtime.maxIterations,
					providerOptions: runtime.providerOptions,
				};
			},
			permissions: {
				requestApproval: input.host.approval
					? (request, signal) => input.host.approval!.request(projectPermissionRequest(sessionId, request), signal)
					: undefined,
				selectSettings: (snapshot) =>
					selectPermissionSettings(snapshot.settings.permissions, execution.permissionMode),
			},
			agentPlugins: input.host.capabilitySources?.plugins
				? {
						directories: input.host.capabilitySources.plugins.directories as readonly (
							| string
							| AgentPluginDirectory
						)[],
						...(input.host.capabilitySources.plugins.dataDirectory
							? { dataDirectory: input.host.capabilitySources.plugins.dataDirectory }
							: {}),
						...(input.host.capabilitySources.plugins.scope
							? { scope: input.host.capabilitySources.plugins.scope }
							: {}),
					}
				: false,
			connector: input.host.connector
				? {
						enabled: true,
						resolveClient: async (snapshot) => {
							const authority = input.host.connector!;
							const resolved = authority.resolve
								? await authority.resolve({ settings: snapshot.settings })
								: authority.client;
							if (!resolved) return undefined;
							if (isConnectorClientHandle(resolved)) {
								return {
									client: resolved.client as ConnectorService,
									...(resolved.close ? { close: resolved.close } : {}),
								};
							}
							return resolved as ConnectorService;
						},
						...(input.host.connector.requestApproval
							? {
									requestApproval: (request: InternalConnectorApprovalRequest, signal?: AbortSignal) =>
										input.host.connector!.requestApproval!(projectConnectorApprovalRequest(request), signal),
								}
							: {}),
					}
				: false,
			agent: {
				maxIterations: execution.maxTurns,
				...(execution.compactionSummaryInstructions
					? { compaction: { summaryInstructions: execution.compactionSummaryInstructions } }
					: {}),
			},
		});
		if (!modelRuntime) {
			throw new CodingSdkFailure({
				phase: "runtime_creation",
				code: "coding_sdk.model_unavailable",
				message: "Model runtime was not resolved during Agent creation",
			});
		}
		return Result.ok(
			new PublicCodingAgent<TAppState>(internal, sessionId, execution, modelRuntime, ephemeralDirectory),
		);
	} catch (error) {
		if (ephemeralDirectory) await rm(ephemeralDirectory, { recursive: true, force: true }).catch(() => {});
		return Result.err(projectError(error, "runtime_creation"));
	}
}

type CodingSchema = typeof codingAgentConfigDefinition.schema;
type TSchema = CodingSchema;

class PublicCodingAgent<TAppState extends JsonObject> implements CodingAgent<TAppState> {
	readonly #internal: InternalCodingAgent<CodingSchema, TAppState>;
	readonly #sessionId: string;
	readonly #execution: CodingAgentExecutionConfiguration;
	readonly #model: Model;
	readonly #provider: Provider;
	readonly #ephemeralDirectory?: string;
	readonly #artifacts = new Map<string, CodingAgentArtifact>();
	readonly #pendingArtifacts = new Map<string, CodingAgentArtifact>();
	readonly #stopArtifactProjection: () => void;
	#closed = false;
	#running = false;
	#tail: Promise<void> = Promise.resolve();
	#artifactWriteTail: Promise<void> = Promise.resolve();

	constructor(
		internal: InternalCodingAgent<CodingSchema, TAppState>,
		sessionId: string,
		execution: CodingAgentExecutionConfiguration,
		modelRuntime: { readonly model: Model; readonly provider: Provider },
		ephemeralDirectory?: string,
	) {
		this.#internal = internal;
		this.#sessionId = sessionId;
		this.#execution = execution;
		this.#model = modelRuntime.model;
		this.#provider = modelRuntime.provider;
		this.#ephemeralDirectory = ephemeralDirectory;
		for (const artifact of artifactsFromAppState(internal.state.appState)) this.#artifacts.set(artifact.id, artifact);
		this.#stopArtifactProjection = this.#internal.subscribe((event) => this.#observeArtifact(projectEvent(event)));
	}

	get sessionId(): string {
		return this.#sessionId;
	}

	get execution(): CodingAgentExecutionConfiguration {
		return this.#execution;
	}

	get state(): CodingAgentState<TAppState> {
		const state = this.#internal.state;
		return {
			sessionId: this.#sessionId,
			status: this.#closed ? "closed" : this.#running ? "running" : state.error ? "aborted" : "idle",
			messages: state.messages,
			todos: todosFromAppState(state.appState),
			artifacts: [...this.#artifacts.values()].sort((left, right) => right.updatedAt - left.updatedAt),
			appState: structuredClone(state.appState) as TAppState,
			...(state.error ? { error: projectJson(state.error) as JsonObject } : {}),
		};
	}

	prompt(input: CodingPrompt): Promise<ResultType<CodingRunResult<TAppState>, CodingSdkError>> {
		const run = this.#tail.then(async () => {
			if (this.#closed)
				throw new CodingSdkFailure({
					phase: "lifecycle",
					code: "coding_sdk.agent_closed",
					message: "Agent is closed",
				});
			this.#running = true;
			try {
				const messages = input.attachments?.length
					? await this.#internal.invokeWithAttachments({
							text: input.prompt,
							attachments: input.attachments as readonly InternalCodingAttachment[],
						})
					: await this.#internal.stream(input.prompt).result();
				return { sessionId: this.#sessionId, messages, state: this.state };
			} finally {
				this.#running = false;
			}
		});
		this.#tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run.then(
			(value) => Result.ok<CodingRunResult<TAppState>, CodingSdkError>(value),
			(error) => Result.err<CodingRunResult<TAppState>, CodingSdkError>(projectError(error, "admission")),
		);
	}

	steer(input: CodingPrompt): Promise<ResultType<void, CodingSdkError>> {
		return this.#admit(input, (message) => this.#internal.steer(message));
	}

	followUp(input: CodingPrompt): Promise<ResultType<void, CodingSdkError>> {
		return this.#admit(input, (message) => this.#internal.followUp(message));
	}

	waitForIdle(): Promise<ResultType<void, CodingSdkError>> {
		return this.#tail
			.then(() => this.#internal.waitForIdle())
			.then(
				() => Result.ok(undefined),
				(error) => Result.err(projectError(error, "lifecycle")),
			);
	}

	async generateTitle(input: CodingSessionTitleInput): Promise<ResultType<string, CodingSdkError>> {
		if (this.#closed) {
			return Result.err(
				projectError(
					new CodingSdkFailure({
						phase: "lifecycle",
						code: "coding_sdk.agent_closed",
						message: "Agent is closed",
					}),
					"lifecycle",
				),
			);
		}
		try {
			const assistantText = this.state.messages
				.filter((message) => message.role === "assistant")
				.flatMap((message) => message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])))
				.join("\n")
				.slice(0, 2_000);
			const stream = this.#provider.stream(
				this.#model,
				{
					systemPrompt:
						"Generate a concise session title of at most 8 words. Return only the title, without quotes or punctuation.",
					messages: [
						{
							role: "user",
							content: `User request:\n${input.firstMessage.slice(0, 2_000)}\n\nAssistant response:\n${assistantText}`,
							timestamp: Date.now(),
						},
					],
					tools: [],
				},
				{ temperature: 0, maxTokens: 32 },
			);
			const result = await stream.result();
			if (result.stopReason === "error" || result.stopReason === "aborted") {
				throw new CodingSdkFailure({
					phase: "model",
					code: "coding_sdk.title_generation_failed",
					message: "Session title generation failed",
				});
			}
			return Result.ok(
				result.content
					.flatMap((part) => (part.type === "text" ? [part.text] : []))
					.join("")
					.trim()
					.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""),
			);
		} catch (error) {
			return Result.err(projectError(error, "model"));
		}
	}

	abort(): Promise<ResultType<void, CodingSdkError>> {
		try {
			if (this.#closed)
				return Promise.resolve(
					Result.err(
						projectError(
							new CodingSdkFailure({
								phase: "lifecycle",
								code: "coding_sdk.agent_closed",
								message: "Agent is closed",
							}),
							"lifecycle",
						),
					),
				);
			this.#internal.abort();
			return Promise.resolve(Result.ok(undefined));
		} catch (error) {
			return Promise.resolve(Result.err(projectError(error, "lifecycle")));
		}
	}

	subscribe(listener: (event: CodingAgentEvent) => void): () => void {
		return this.#internal.subscribe((event) => listener(projectEvent(event)));
	}

	async close(): Promise<ResultType<void, CodingSdkError>> {
		if (this.#closed) return Result.ok(undefined);
		try {
			this.#closed = true;
			this.#internal.abort();
			await this.#tail;
			await this.#internal.waitForIdle();
			await this.#artifactWriteTail;
			this.#stopArtifactProjection();
			this.#internal.close();
			if (this.#ephemeralDirectory) await rm(this.#ephemeralDirectory, { recursive: true, force: true });
			return Result.ok(undefined);
		} catch (error) {
			return Result.err(projectError(error, "lifecycle"));
		}
	}

	#observeArtifact(event: CodingAgentEvent): void {
		if (event.type === "tool_execution_start") {
			const artifact = projectArtifact(event.toolName, event.args, event.toolCallId, Date.now());
			if (artifact) this.#pendingArtifacts.set(event.toolCallId, artifact);
			return;
		}
		if (event.type !== "tool_execution_end") return;
		const artifact = this.#pendingArtifacts.get(event.toolCallId);
		this.#pendingArtifacts.delete(event.toolCallId);
		if (!artifact || event.isError) return;
		const current = this.#artifacts.get(artifact.id);
		if (current && current.updatedAt > artifact.updatedAt) return;
		this.#artifacts.set(artifact.id, artifact);
		const write = this.#artifactWriteTail.then(() =>
			this.#internal.updateAppState(
				(currentState) =>
					({
						...currentState,
						artifacts: { version: 1, items: [...this.#artifacts.values()] },
					}) as TAppState,
			),
		);
		this.#artifactWriteTail = write.catch(() => {});
	}

	#admit(input: CodingPrompt, action: (message: AgentMessage) => void): Promise<ResultType<void, CodingSdkError>> {
		try {
			if (this.#closed)
				throw new CodingSdkFailure({
					phase: "lifecycle",
					code: "coding_sdk.agent_closed",
					message: "Agent is closed",
				});
			if (!input.prompt.trim())
				throw new CodingSdkFailure({
					phase: "admission",
					code: "coding_sdk.empty_prompt",
					message: "Prompt must not be empty",
				});
			action({ role: "user", content: input.prompt, timestamp: Date.now() });
			return Promise.resolve(Result.ok(undefined));
		} catch (error) {
			return Promise.resolve(Result.err(projectError(error, "admission")));
		}
	}
}

class CodingSdkFailure extends TaggedError("coding_sdk.failure")<{
	readonly phase: CodingSdkErrorPhase;
	readonly code: string;
	readonly message: string;
}> {}

function resolveSessionId(selection: SessionSelection): string {
	if (selection.kind === "resume") return selection.id;
	if (selection.kind === "new" && selection.id) return selection.id;
	return `coding-${randomUUID()}`;
}

async function resolveSessionDirectory(
	input: CodingAgentCreateInput,
	_sessionId: string,
	setEphemeralDirectory: (directory: string) => void,
): Promise<string> {
	if (input.session.kind !== "ephemeral") return input.host.session.directory;
	const root = await mkdtemp(path.join(tmpdir(), "jai-coding-agent-"));
	setEphemeralDirectory(root);
	return root;
}

async function validateSessionSelection<TAppState extends JsonObject>(
	selection: SessionSelection,
	store: FileSessionStore<TAppState>,
	sessionId: string,
): Promise<void> {
	const existing = await store.load(sessionId);
	if (selection.kind === "resume" && !existing) {
		throw new CodingSdkFailure({
			phase: "session",
			code: "coding_sdk.session_not_found",
			message: `Session "${sessionId}" was not found`,
		});
	}
	if (selection.kind === "new" && existing) {
		throw new CodingSdkFailure({
			phase: "session",
			code: "coding_sdk.session_exists",
			message: `Session "${sessionId}" already exists`,
		});
	}
}

function selectPermissionSettings(
	settings: PermissionSettings | undefined,
	mode?: CodingPermissionMode,
): PermissionSettings {
	return { ...(settings ?? {}), ...(mode ? { defaultMode: mode } : {}) };
}

function isConnectorClientHandle(
	value: unknown,
): value is { readonly client: unknown; readonly close?: () => void | Promise<void> } {
	return isRecord(value) && "client" in value;
}

function projectConnectorApprovalRequest(request: InternalConnectorApprovalRequest): CodingConnectorApprovalRequest {
	return {
		requestId: request.requestId,
		sessionId: request.sessionId,
		toolCallId: request.toolCallId,
		toolName: "connector__execute_action",
		actionId: request.actionId,
		reason: request.reason,
		sideEffect: request.sideEffect,
		dataSensitivity: request.dataSensitivity,
		inputKeys: [...request.inputKeys],
		expiresAt: request.expiresAt,
	};
}

function projectArtifact(
	toolName: string,
	args: JsonValue,
	toolCallId: string,
	updatedAt: number,
): CodingAgentArtifact | undefined {
	if (toolName !== "Write" && toolName !== "Edit") return undefined;
	if (!isRecord(args) || typeof args.path !== "string" || !args.path.trim()) return undefined;
	const extension = path.extname(args.path).toLowerCase();
	const format =
		extension === ".html" || extension === ".htm"
			? "html"
			: extension === ".md" || extension === ".markdown" || extension === ".mdown" || extension === ".mkd"
				? "markdown"
				: undefined;
	if (!format) return undefined;
	return { id: `artifact:${args.path}`, toolCallId, path: args.path, format, updatedAt };
}

function artifactsFromAppState(appState: JsonObject): readonly CodingAgentArtifact[] {
	const value = appState.artifacts;
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return [];
	return value.items.flatMap((candidate) => {
		if (!isRecord(candidate)) return [];
		if (
			typeof candidate.id !== "string" ||
			typeof candidate.toolCallId !== "string" ||
			typeof candidate.path !== "string" ||
			(candidate.format !== "markdown" && candidate.format !== "html") ||
			typeof candidate.updatedAt !== "number"
		) {
			return [];
		}
		return [
			{
				id: candidate.id,
				toolCallId: candidate.toolCallId,
				path: candidate.path,
				format: candidate.format,
				updatedAt: candidate.updatedAt,
			} satisfies CodingAgentArtifact,
		];
	});
}

function projectPermissionRequest(
	sessionId: string,
	request: {
		readonly requestId: string;
		readonly toolCallId: string;
		readonly toolName: CodingToolName;
		readonly args: Readonly<Record<string, unknown>>;
		readonly reason: string;
		readonly canAlwaysAllow: boolean;
		readonly suggestedRule?: string;
		readonly suggestedRules?: readonly string[];
		readonly rememberScope?: "session" | "project-local";
	},
): CodingPermissionRequest {
	return {
		requestId: request.requestId,
		sessionId,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		args: projectJson(request.args) as Readonly<Record<string, JsonValue>>,
		reason: request.reason,
		canAlwaysAllow: request.canAlwaysAllow,
		...(request.suggestedRule ? { suggestedRule: request.suggestedRule } : {}),
		...(request.suggestedRules ? { suggestedRules: request.suggestedRules } : {}),
		...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
	};
}

function projectEvent(event: AgentEvent): CodingAgentEvent {
	switch (event.type) {
		case "agent_start":
			return { type: "agent_start" };
		case "agent_end":
			return { type: "agent_end", messages: projectMessages(event.messages) };
		case "turn_start":
			return { type: "turn_start" };
		case "turn_end":
			return {
				type: "turn_end",
				message: projectMessage(event.message) as CodingAssistantMessage,
				toolResults: projectJson(event.toolResults) as unknown as readonly CodingToolResult[],
			};
		case "message_start":
			return { type: "message_start", message: projectMessage(event.message) };
		case "message_update":
			return {
				type: "message_update",
				message: projectMessage(event.message) as CodingAssistantMessage,
				assistantEvent: projectJson(event.assistantEvent) as unknown as AssistantMessageEvent,
			};
		case "message_end":
			return { type: "message_end", message: projectMessage(event.message) };
		case "tool_execution_start":
			return {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				title: event.title,
				args: projectJson(event.args),
			};
		case "tool_execution_update":
			return {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				partial: projectJson(event.partial),
			};
		case "tool_execution_end":
			return {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: projectJson(event.result),
				isError: event.isError,
			};
		case "compaction_start":
			return { type: "compaction_start", trigger: event.trigger, tokensBefore: event.tokensBefore };
		case "compaction_end":
			return { type: "compaction_end", outcome: projectJson(event.outcome) };
	}
}

function projectMessages(messages: readonly AgentMessage[]): readonly CodingAgentMessage[] {
	return messages.map(projectMessage);
}

function projectMessage(message: AgentMessage): CodingAgentMessage {
	return projectJson(message) as unknown as CodingAgentMessage;
}

function projectError(error: unknown, phase: CodingSdkErrorPhase): CodingSdkError {
	const record = isRecord(error) ? error : {};
	const code =
		error instanceof CodingSdkFailure
			? error.code
			: typeof record._tag === "string"
				? record._tag
				: "coding_sdk.unknown";
	const message =
		error instanceof Error ? error.message : typeof record.message === "string" ? record.message : String(error);
	return {
		code,
		message,
		retryable: phase === "model" || phase === "tool",
		phase: error instanceof CodingSdkFailure ? error.phase : phase,
	};
}

function projectJson(value: unknown): JsonValue {
	try {
		return JSON.parse(JSON.stringify(value)) as JsonValue;
	} catch {
		return { message: "Value was not JSON-serializable" };
	}
}

function todosFromAppState(appState: JsonObject): readonly CodingAgentTodo[] {
	const todos = appState.todos;
	if (!isRecord(todos) || !Array.isArray(todos.items)) return [];
	return todos.items.flatMap((item) => {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.content !== "string") return [];
		if (
			item.status !== "pending" &&
			item.status !== "in_progress" &&
			item.status !== "completed" &&
			item.status !== "cancelled"
		)
			return [];
		return [{ id: item.id, content: item.content, status: item.status }];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
