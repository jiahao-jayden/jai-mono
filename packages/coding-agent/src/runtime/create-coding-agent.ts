import {
	Agent,
	type AgentCompactionOptions,
	type AgentEvent,
	type AgentEventListener,
	type AgentHookMap,
	type AgentInput,
	type AgentMessage,
	type AgentTool,
	type EffectBoundary,
	type JsonObject,
	type ModelRequestObserver,
	type ObserverErrorInfo,
	openSession,
	type SessionHandle,
	type SessionStore,
	type ToolExecutionMode,
	type ToolMiddleware,
} from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node/environment";
import type { Model, Provider } from "@jai/ai";
import type { TObject } from "@sinclair/typebox";
import { attachmentUserMessage, CodingAttachmentRun, type CodingMessageAttachment } from "../attachments";
import type { CodingCommandDispatch, CodingCommandRegistry } from "../commands";
import {
	type CodingConfigDefinition,
	CodingConfigStore,
	type CodingConfigStoreOptions,
	type ConfigSnapshot,
	type ResolvedCodingSettings,
} from "../config";
import {
	createPermissionMiddleware,
	type ExtensionToolPermissionResolver,
	type PermissionAction,
	type PermissionApprovalDecision,
	type PermissionApprovalRequest,
	type PermissionSettings,
	type PermissionTelemetryObserver,
	permissionSettingsFromConfig,
} from "../permissions";
import type { CodingToolOptions } from "../tools";
import type { CodingToolName } from "../tools/names";
import { assembleAgentCapabilities } from "./assemble";
import type { OpenChildSession, RunAgentExecution } from "./execution";
import type { CodingExecutionContext } from "./execution-context";
import type { ToolCatalog } from "./tool-catalog";

export type { OpenChildSession };

export interface ResolvedCodingProvider {
	readonly provider: Provider;
	readonly model: Model;
}

export interface CodingAgentPermissionOptions<TSchema extends TObject> {
	readonly selectSettings?: (snapshot: ConfigSnapshot<TSchema>) => PermissionSettings;
	readonly requestApproval?: (
		request: PermissionApprovalRequest,
		signal?: AbortSignal,
	) => PermissionApprovalDecision | Promise<PermissionApprovalDecision>;
	readonly persistProjectLocalAllowRules?: (rules: readonly string[]) => void | Promise<void>;
	/** 可选旁路，观察权限事实而不参与判定或审批。 */
	readonly telemetryObserver?: PermissionTelemetryObserver;
}

export interface CodingAgentRuntimeOptions {
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly providerOptions?: Record<string, Record<string, unknown>>;
	readonly maxIterations?: number;
	readonly toolExecution?: ToolExecutionMode;
	readonly compaction?: AgentCompactionOptions;
	readonly effectBoundary?: EffectBoundary;
	readonly hooks?: AgentHookMap;
	readonly onObserverError?: (info: ObserverErrorInfo<AgentEvent>) => void;
}

export interface CreateCodingAgentOptions<TSchema extends TObject, TAppState extends JsonObject = JsonObject> {
	readonly executionContext: CodingExecutionContext;
	readonly sessionId: string;
	readonly sessionStore: SessionStore<TAppState>;
	readonly appState?: TAppState;
	readonly instructions?: string;
	readonly resolveInstructions?: (snapshot: ConfigSnapshot<TSchema>) => string | Promise<string>;
	readonly configDefinition: CodingConfigDefinition<TSchema>;
	readonly configOptions?: Omit<CodingConfigStoreOptions, "projectRoot">;
	readonly resolveProvider: (
		snapshot: ConfigSnapshot<TSchema>,
	) => ResolvedCodingProvider | Promise<ResolvedCodingProvider>;
	readonly permissions?: CodingAgentPermissionOptions<TSchema>;
	readonly tools?: Omit<CodingToolOptions, "cwd">;
	readonly enabledTools?: ReadonlySet<CodingToolName>;
	readonly extensionTools?: readonly AgentTool[];
	readonly extensionToolMiddleware?: ToolMiddleware;
	readonly extensionToolPermissions?: ReadonlyMap<string, ExtensionToolPermissionResolver>;
	readonly extensionAuthorizedToolNames?: ReadonlySet<string>;
	readonly extensionToolCatalog?: ToolCatalog;
	readonly extensionBeforeModelCall?: (messages: readonly AgentMessage[]) => Promise<AgentMessage[]>;
	readonly modelRequestObserver?: ModelRequestObserver;
	readonly commands?: CodingCommandRegistry;
	readonly agent?: CodingAgentRuntimeOptions;
	readonly resolveAgentOptions?: (
		snapshot: ConfigSnapshot<TSchema>,
		resolved: ResolvedCodingProvider,
	) => CodingAgentRuntimeOptions | Promise<CodingAgentRuntimeOptions>;
	/** Host-supplied factory that opens a journal-only child session for each subagent invocation. */
	readonly openChildSession?: OpenChildSession<TAppState>;
}

interface ExtensionToolCatalogSlot {
	current?: ToolCatalog;
}

interface RuntimeState<TSchema extends TObject> {
	snapshot: ConfigSnapshot<TSchema>;
	closed: boolean;
}

export class CodingAgent<TSchema extends TObject, TAppState extends JsonObject = JsonObject> {
	readonly configStore: CodingConfigStore<TSchema>;
	readonly runAgent: RunAgentExecution;
	readonly #agent: Agent<TAppState>;
	readonly #runtime: RuntimeState<TSchema>;
	readonly #stopConfigWatch: () => void;
	readonly #commands?: CodingCommandRegistry;
	readonly #attachments: CodingAttachmentRun;

	constructor(
		agent: Agent<TAppState>,
		configStore: CodingConfigStore<TSchema>,
		runtime: RuntimeState<TSchema>,
		stopConfigWatch: () => void,
		commands: CodingCommandRegistry | undefined,
		attachments: CodingAttachmentRun,
		runAgent: RunAgentExecution,
	) {
		this.#agent = agent;
		this.configStore = configStore;
		this.#runtime = runtime;
		this.#stopConfigWatch = stopConfigWatch;
		this.#commands = commands;
		this.#attachments = attachments;
		this.runAgent = runAgent;
	}

	get configSnapshot(): ConfigSnapshot<TSchema> {
		return this.#runtime.snapshot;
	}

	get state() {
		return this.#agent.state;
	}

	updateAppState(update: (current: TAppState) => TAppState): Promise<void> {
		return this.#agent.updateAppState(update);
	}

	async invoke(input: AgentInput): Promise<AgentMessage[]> {
		const command = await this.#dispatchCommand(input);
		if (command?.kind === "handled") return [];
		const prepared = command?.kind === "prompt" ? command.input : input;
		try {
			return await this.#agent.invoke(prepared);
		} finally {
			this.#commands?.clearPromptContext();
		}
	}

	invokeWithAttachments(input: {
		readonly text: string;
		readonly attachments: readonly CodingMessageAttachment[];
	}): Promise<AgentMessage[]> {
		const message = attachmentUserMessage({ text: input.text, attachments: input.attachments });
		return this.#attachments.invoke(input.attachments, async () => {
			const command = await this.#dispatchCommand(message);
			if (command?.kind === "handled") return [];
			const prepared = command?.kind === "prompt" ? command.input : message;
			try {
				return await this.#agent.invoke(prepared);
			} finally {
				this.#commands?.clearPromptContext();
			}
		});
	}

	advance(
		input: readonly { readonly message: AgentMessage; readonly entryId?: string }[] = [],
	): Promise<AgentMessage[]> {
		return this.#agent.streamFromDurableContextWithReservedEntries(input).result();
	}

	subscribe(listener: AgentEventListener): () => void {
		return this.#agent.subscribe(listener);
	}

	steer(message: AgentMessage, entryId?: string): void {
		this.#agent.steer(message, entryId);
	}

	followUp(message: AgentMessage, entryId?: string): void {
		this.#agent.followUp(message, entryId);
	}

	abort(): void {
		this.#agent.abort();
	}

	waitForIdle(): Promise<void> {
		return this.#agent.waitForIdle();
	}

	navigate(entryId: string): Promise<void> {
		return this.#agent.navigate(entryId);
	}

	async #dispatchCommand(input: AgentInput): Promise<CodingCommandDispatch | undefined> {
		if (!this.#commands) return undefined;
		const dispatched = await this.#commands.dispatch(input);
		if (dispatched.isErr()) throw dispatched.error;
		return dispatched.value;
	}

	close(): void {
		if (this.#runtime.closed) return;
		this.#runtime.closed = true;
		this.#agent.abort();
		this.#stopConfigWatch();
		this.configStore.close();
	}
}

export async function createCodingAgent<TSchema extends TObject, TAppState extends JsonObject = JsonObject>(
	options: CreateCodingAgentOptions<TSchema, TAppState>,
): Promise<CodingAgent<TSchema, TAppState>> {
	const configStore = new CodingConfigStore(options.configDefinition, {
		...options.configOptions,
		projectRoot: options.executionContext.localFileAccess ? options.executionContext.configRoot : undefined,
	});
	const snapshot = await configStore.load();
	const runtime: RuntimeState<TSchema> = { snapshot, closed: false };
	const { provider, model } = await options.resolveProvider(snapshot);
	const resolvedInstructions = options.resolveInstructions
		? await options.resolveInstructions(snapshot)
		: options.instructions;
	const resolvedAgentOptions = {
		...options.agent,
		...(options.resolveAgentOptions ? await options.resolveAgentOptions(snapshot, { provider, model }) : {}),
	};
	const sessionHandle = await openSession(
		options.sessionStore,
		options.sessionId,
		options.appState ?? ({} as TAppState),
	);
	const selectPermissionSettings =
		options.permissions?.selectSettings ??
		((snapshot: ConfigSnapshot<TSchema>) =>
			permissionSettingsFromConfig(snapshot.settings as Readonly<Record<string, unknown>>));
	const sessionAllowRules = {};
	const persistProjectLocalAllowRules =
		options.permissions?.persistProjectLocalAllowRules ??
		(async (rules: readonly string[]) => {
			const next = await persistBashAllowRules(configStore, rules);
			if (next) runtime.snapshot = next;
		});
	const attachments = new CodingAttachmentRun();
	const hooks = resolvedAgentOptions.hooks;
	const beforeModelCall = [...(hooks?.beforeModelCall ?? [])];
	beforeModelCall.unshift(async ({ messages }) => {
		const projected = await attachments.project(messages);
		return projected ? { messages: projected } : undefined;
	});
	if (options.extensionBeforeModelCall) {
		beforeModelCall.push(async ({ messages }) => ({
			messages: await options.extensionBeforeModelCall!(messages),
		}));
	}
	if (options.commands) {
		beforeModelCall.push(({ messages }) => {
			const context = options.commands?.promptContext();
			if (!context) return;
			return {
				messages: [
					...messages,
					{
						role: "user",
						content: [{ type: "text", text: context, synthetic: true }],
						timestamp: Date.now(),
					},
				],
			};
		});
	}
	const toolEnvironment = options.executionContext.localFileAccess
		? new NodeExecutionEnvironment({
				cwd: options.executionContext.cwd,
				shellPath: options.tools?.shell,
			})
		: undefined;
	const extensionToolCatalog: ExtensionToolCatalogSlot = { current: options.extensionToolCatalog };
	const coreToolPermissions = new Map<string, ExtensionToolPermissionResolver>();
	if (extensionToolCatalog.current) {
		coreToolPermissions.set("SearchTools", () => extensionToolCatalog.current!.permission);
	}
	const permissionMiddleware = createPermissionMiddleware({
		workspaceRoot: options.executionContext.localFileAccess ? options.executionContext.cwd : process.cwd(),
		settings: () => selectPermissionSettings(runtime.snapshot),
		extensionToolPermissions: options.extensionToolPermissions,
		coreToolPermissions,
		extensionAuthorizedToolNames: options.extensionAuthorizedToolNames,
		requestApproval: options.permissions?.requestApproval,
		persistProjectLocalAllowRules,
		pathCapabilities: toolEnvironment,
		sessionAllowRules,
		telemetryObserver: options.permissions?.telemetryObserver,
	});
	const runAgent: RunAgentExecution = async ({
		prompt,
		instructions,
		excludeTools = [],
		signal,
		onActivity,
		toolCallId,
	}) => {
		signal?.throwIfAborted();
		const allowed = (tool: AgentTool) => !excludeTools.includes(tool.name);
		const childToolCatalog = extensionToolCatalog.current?.createScope(allowed);
		const childCapabilities = assembleAgentCapabilities({
			kind: "isolated",
			executionContext: options.executionContext,
			toolOptions: options.tools,
			toolEnvironment,
			enabledTools: options.enabledTools,
			permissionMiddleware,
			extensionTools: options.extensionTools,
			extensionToolMiddleware: options.extensionToolMiddleware,
			extraTools: childToolCatalog ? [childToolCatalog.searchTool] : [],
		});
		const childSessionHandle = options.openChildSession ? await options.openChildSession(toolCallId) : undefined;
		const child = new Agent({
			model,
			provider,
			tools: childCapabilities.tools.filter(allowed),
			instructions: [resolvedInstructions, instructions].filter(Boolean).join("\n\n"),
			...(childSessionHandle ? { sessionHandle: childSessionHandle as SessionHandle<JsonObject> } : {}),
			temperature: resolvedAgentOptions.temperature,
			maxTokens: resolvedAgentOptions.maxTokens,
			providerOptions: resolvedAgentOptions.providerOptions,
			maxIterations: resolvedAgentOptions.maxIterations,
			toolExecution: resolvedAgentOptions.toolExecution,
			compaction: resolvedAgentOptions.compaction,
			...(childToolCatalog ? { resolveTools: (staticTools) => childToolCatalog.toolsForRequest(staticTools) } : {}),
			hooks: {
				aroundToolCall: childCapabilities.aroundToolCall,
				onEvent: childCapabilities.onEvent,
			},
			onObserverError: resolvedAgentOptions.onObserverError,
		});
		const unsubscribe = child.subscribe((event) => {
			const activity = event.type === "tool_execution_start" ? event.toolName : undefined;
			if (activity) onActivity?.(activity);
		});
		const abortChild = () => child.abort();
		signal?.addEventListener("abort", abortChild, { once: true });

		try {
			signal?.throwIfAborted();
			return await child.invoke(prompt);
		} finally {
			signal?.removeEventListener("abort", abortChild);
			unsubscribe();
			child.abort();
			await child.waitForIdle();
		}
	};
	const primaryTools = extensionToolCatalog.current ? [extensionToolCatalog.current.searchTool] : [];
	const capabilities = assembleAgentCapabilities({
		kind: "primary",
		executionContext: options.executionContext,
		toolOptions: options.tools,
		toolEnvironment,
		enabledTools: options.enabledTools,
		attachments: options.executionContext.localFileAccess ? attachments : undefined,
		permissionMiddleware,
		extensionTools: options.extensionTools,
		extensionToolMiddleware: options.extensionToolMiddleware,
		extraTools: primaryTools,
		extraAroundToolCall: hooks?.aroundToolCall,
		extraOnEvent: hooks?.onEvent,
	});
	const staticTools = capabilities.tools;
	const agent = new Agent<TAppState>({
		model,
		provider,
		tools: staticTools,
		sessionHandle,
		instructions: resolvedInstructions,
		temperature: resolvedAgentOptions.temperature,
		maxTokens: resolvedAgentOptions.maxTokens,
		providerOptions: resolvedAgentOptions.providerOptions,
		maxIterations: resolvedAgentOptions.maxIterations,
		toolExecution: resolvedAgentOptions.toolExecution,
		compaction: resolvedAgentOptions.compaction,
		...(extensionToolCatalog.current
			? { resolveTools: (staticTools) => extensionToolCatalog.current!.toolsForRequest(staticTools) }
			: {}),
		effectBoundary: resolvedAgentOptions.effectBoundary,
		modelRequestObserver: options.modelRequestObserver,
		hooks: {
			...hooks,
			beforeModelCall,
			aroundToolCall: capabilities.aroundToolCall,
			onEvent: capabilities.onEvent,
		},
		onObserverError: resolvedAgentOptions.onObserverError,
	});
	const stopConfigWatch = configStore.watch((event) => {
		if (!runtime.closed && event.status === "valid") runtime.snapshot = event.snapshot;
	});
	return new CodingAgent(agent, configStore, runtime, stopConfigWatch, options.commands, attachments, runAgent);
}

async function persistBashAllowRules<TSchema extends TObject>(
	store: CodingConfigStore<TSchema>,
	rules: readonly string[],
): Promise<ConfigSnapshot<TSchema> | undefined> {
	const patterns = [
		...new Set(rules.flatMap((rule) => (rule.startsWith("bash:") ? [rule.slice("bash:".length)] : []))),
	];
	if (patterns.length === 0) return;
	for (let attempt = 0; attempt < 2; attempt++) {
		const scope = await store.readScope("project-local");
		const settings = structuredClone(scope.settings) as Record<string, unknown>;
		const permission = isRecord(settings.permission) ? { ...settings.permission } : {};
		const currentBash = permission.bash;
		const bash: Record<string, PermissionAction> =
			currentBash === "allow" || currentBash === "ask" || currentBash === "deny"
				? { "*": currentBash }
				: isRecord(currentBash)
					? Object.fromEntries(
							Object.entries(currentBash).filter(
								(entry): entry is [string, PermissionAction] =>
									entry[1] === "allow" || entry[1] === "ask" || entry[1] === "deny",
							),
						)
					: {};
		for (const pattern of patterns) {
			delete bash[pattern];
			bash[pattern] = "allow";
		}
		permission.bash = bash;
		settings.permission = permission;
		try {
			return await store.writeScope("project-local", settings as Partial<ResolvedCodingSettings<TSchema>>, {
				expectedRevision: scope.revision,
			});
		} catch (error) {
			if (!isRecord(error) || error._tag !== "coding_config.write_conflict" || attempt === 1) throw error;
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
