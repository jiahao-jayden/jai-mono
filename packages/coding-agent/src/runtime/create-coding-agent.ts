import { homedir } from "node:os";
import {
	Agent,
	type AgentCompactionOptions,
	type AgentEvent,
	type AgentEventListener,
	type AgentHookMap,
	type AgentInput,
	type AgentMessage,
	type AgentRun,
	type AgentTool,
	type JsonObject,
	type ObserverErrorInfo,
	openSession,
	type SessionStore,
	type ToolExecutionMode,
	type ToolMiddleware,
} from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node";
import type { Model, Provider } from "@jai/ai";
import type { TObject } from "@sinclair/typebox";
import { attachmentUserMessage, CodingAttachmentRun, type CodingMessageAttachment } from "../attachments";
import {
	type CodingConfigDefinition,
	CodingConfigStore,
	type CodingConfigStoreOptions,
	type ConfigSnapshot,
	type ResolvedCodingSettings,
} from "../config";
import { connectMcpServers, type McpRuntime, type McpServer } from "../mcp";
import {
	createPermissionMiddleware,
	type ExtensionToolPermissionResolver,
	type PermissionAction,
	type PermissionApprovalDecision,
	type PermissionApprovalRequest,
	type PermissionConfig,
	type PermissionSettings,
} from "../permissions";
import { type CodingPluginSkillCard, CodingSkillsRuntime, type CodingSkillsRuntimeOptions } from "../skills";
import {
	type CodingToolOptions,
	createSpawnAgentTool,
	createUpdateTodosTool,
	type SessionTodoItem,
	type SessionTodos,
} from "../tools";
import type { CodingToolName } from "../tools/names";
import { assembleAgentCapabilities } from "./assemble";
import type { CodingExecutionContext } from "./execution-context";
import type { ToolCatalog } from "./tool-catalog";

const SUBAGENT_INSTRUCTIONS =
	"You are an internal subagent. Complete only the delegated task using the available tools, then return a concise final result to the parent agent. You cannot see the parent conversation, so rely only on the task and workspace.";

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
}

export interface CodingAgentRuntimeOptions {
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly providerOptions?: Record<string, Record<string, unknown>>;
	readonly maxIterations?: number;
	readonly toolExecution?: ToolExecutionMode;
	readonly compaction?: AgentCompactionOptions;
	readonly hooks?: AgentHookMap;
	readonly onObserverError?: (info: ObserverErrorInfo<AgentEvent>) => void;
}

export interface CodingAgentSkillsOptions
	extends Partial<Pick<CodingSkillsRuntimeOptions, "homeDirectory" | "workspaceDirectory" | "workspaceTrusted">> {
	readonly debounceMs?: number;
	readonly commandNames?: readonly string[];
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
	readonly resolveMcpServers?: (
		snapshot: ConfigSnapshot<TSchema>,
	) => readonly McpServer[] | Promise<readonly McpServer[]>;
	readonly permissions?: CodingAgentPermissionOptions<TSchema>;
	readonly skills?: false | CodingAgentSkillsOptions;
	readonly tools?: Omit<CodingToolOptions, "cwd">;
	readonly enabledTools?: ReadonlySet<CodingToolName>;
	readonly extensionSkills?: readonly CodingPluginSkillCard[];
	readonly extensionTools?: readonly AgentTool[];
	readonly extensionToolMiddleware?: ToolMiddleware;
	readonly extensionToolPermissions?: ReadonlyMap<string, ExtensionToolPermissionResolver>;
	readonly extensionAuthorizedToolNames?: ReadonlySet<string>;
	extensionToolCatalog?: ToolCatalog;
	readonly extensionBeforeModelCall?: (messages: readonly AgentMessage[]) => Promise<AgentMessage[]>;
	readonly agent?: CodingAgentRuntimeOptions;
	readonly resolveAgentOptions?: (
		snapshot: ConfigSnapshot<TSchema>,
		resolved: ResolvedCodingProvider,
	) => CodingAgentRuntimeOptions | Promise<CodingAgentRuntimeOptions>;
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
	readonly #agent: Agent<TAppState>;
	readonly #runtime: RuntimeState<TSchema>;
	readonly #stopConfigWatch: () => void;
	readonly #skills?: CodingSkillsRuntime;
	readonly #mcp?: McpRuntime;
	readonly #attachments: CodingAttachmentRun;
	readonly #extensionToolCatalog: ExtensionToolCatalogSlot;
	readonly #coreToolPermissions: Map<string, ExtensionToolPermissionResolver>;

	constructor(
		agent: Agent<TAppState>,
		configStore: CodingConfigStore<TSchema>,
		runtime: RuntimeState<TSchema>,
		stopConfigWatch: () => void,
		skills?: CodingSkillsRuntime,
		mcp?: McpRuntime,
		attachments: CodingAttachmentRun = new CodingAttachmentRun(),
		extensionToolCatalog: ExtensionToolCatalogSlot = {},
		coreToolPermissions: Map<string, ExtensionToolPermissionResolver> = new Map(),
	) {
		this.#agent = agent;
		this.configStore = configStore;
		this.#runtime = runtime;
		this.#stopConfigWatch = stopConfigWatch;
		this.#skills = skills;
		this.#mcp = mcp;
		this.#attachments = attachments;
		this.#extensionToolCatalog = extensionToolCatalog;
		this.#coreToolPermissions = coreToolPermissions;
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

	get mcpDiagnostics() {
		return this.#mcp?.diagnostics ?? [];
	}

	setExtensionToolCatalog(catalog: ToolCatalog): void {
		this.#extensionToolCatalog.current = catalog;
		this.#coreToolPermissions.set("SearchTools", () => catalog.permission);
		this.#agent.setToolResolver((staticTools) => catalog.toolsForRequest(staticTools));
		this.#agent.addTools([catalog.searchTool]);
	}

	invoke(input: AgentInput): Promise<AgentMessage[]> {
		return this.#agent.invoke(this.#skills?.prepareInput(input).input ?? input);
	}

	invokeWithAttachments(input: {
		readonly text: string;
		readonly attachments: readonly CodingMessageAttachment[];
	}): Promise<AgentMessage[]> {
		const message = attachmentUserMessage({ text: input.text, attachments: input.attachments });
		const prepared = this.#skills?.prepareInput(message).input ?? message;
		return this.#attachments.invoke(input.attachments, () => this.#agent.invoke(prepared));
	}

	stream(input: AgentInput): AgentRun {
		return this.#agent.stream(this.#skills?.prepareInput(input).input ?? input);
	}

	subscribe(listener: AgentEventListener): () => void {
		return this.#agent.subscribe(listener);
	}

	steer(message: AgentMessage): void {
		this.#agent.steer(message);
	}

	followUp(message: AgentMessage): void {
		this.#agent.followUp(message);
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

	close(): void {
		if (this.#runtime.closed) return;
		this.#runtime.closed = true;
		this.#agent.abort();
		this.#stopConfigWatch();
		this.#skills?.close();
		void this.#mcp?.close();
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
	const mcp = await createMcpRuntime(options.resolveMcpServers ? await options.resolveMcpServers(snapshot) : []);
	let skills: CodingSkillsRuntime | undefined;
	try {
		skills =
			options.enabledTools?.has("Skill") === false
				? undefined
				: await createSkillsRuntime(options, options.extensionSkills);
	} catch (error) {
		await mcp?.close();
		throw error;
	}
	const sessionHandle = await openSession(
		options.sessionStore,
		options.sessionId,
		options.appState ?? ({} as TAppState),
	);
	const selectPermissionSettings = options.permissions?.selectSettings ?? defaultPermissionSettings;
	const sessionAllowRules = new Set<string>();
	const persistProjectLocalAllowRules =
		options.permissions?.persistProjectLocalAllowRules ??
		(async (rules: readonly string[]) => {
			const next = await persistBashAllowRules(configStore, rules);
			if (next) runtime.snapshot = next;
		});
	let agent!: Agent<TAppState>;
	const attachments = new CodingAttachmentRun();
	const updateTodosTool = createUpdateTodosTool(async (items) => {
		const todos: SessionTodos = {
			version: 1,
			updatedAt: Date.now(),
			items: items.map((item) => ({ ...item })),
		};
		const next = { ...agent.state.appState, todos } as TAppState;
		await agent.setAppState(next);
		return todos;
	});
	const hooks = resolvedAgentOptions.hooks;
	const beforeModelCall = [...(hooks?.beforeModelCall ?? [])];
	beforeModelCall.unshift(async ({ messages }) => {
		const projected = await attachments.project(messages);
		return projected ? { messages: projected } : undefined;
	});
	beforeModelCall.push(({ messages }) => {
		const todos = sessionTodosFromAppState(agent.state.appState);
		if (!todos) return;
		return {
			messages: [
				...messages,
				{
					role: "user",
					content: [
						{
							type: "text",
							text: `Current session Todo state (internal state data, not a new user request):\n${JSON.stringify(todos.items)}`,
							synthetic: true,
						},
					],
					timestamp: todos.updatedAt,
				},
			],
		};
	});
	if (options.extensionBeforeModelCall) {
		beforeModelCall.push(async ({ messages }) => ({
			messages: await options.extensionBeforeModelCall!(messages),
		}));
	}
	const toolEnvironment = options.executionContext.localFileAccess
		? new NodeExecutionEnvironment({
				cwd: options.executionContext.cwd,
				shellPath: options.tools?.shell,
				ripgrepPath: options.tools?.ripgrepPath,
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
	});
	const spawnAgentTool = createSpawnAgentTool(async ({ task, signal, onActivity }) => {
		signal?.throwIfAborted();
		const childToolCatalog = extensionToolCatalog.current?.createScope();
		const childSkills =
			options.enabledTools?.has("Skill") === false
				? undefined
				: await createSkillsRuntime(options, options.extensionSkills);
		const childCapabilities = assembleAgentCapabilities({
			kind: "subagent",
			executionContext: options.executionContext,
			toolOptions: options.tools,
			toolEnvironment,
			enabledTools: options.enabledTools,
			skills: childSkills,
			mcp,
			permissionMiddleware,
			extensionTools: options.extensionTools,
			extensionToolMiddleware: options.extensionToolMiddleware,
			extraTools: childToolCatalog ? [childToolCatalog.searchTool] : [],
		});
		let child: Agent;
		try {
			child = new Agent({
				model,
				provider,
				tools: childCapabilities.tools,
				instructions: [resolvedInstructions, SUBAGENT_INSTRUCTIONS].filter(Boolean).join("\n\n"),
				temperature: resolvedAgentOptions.temperature,
				maxTokens: resolvedAgentOptions.maxTokens,
				providerOptions: resolvedAgentOptions.providerOptions,
				maxIterations: resolvedAgentOptions.maxIterations,
				toolExecution: resolvedAgentOptions.toolExecution,
				compaction: resolvedAgentOptions.compaction,
				...(childToolCatalog
					? { resolveTools: (staticTools) => childToolCatalog.toolsForRequest(staticTools) }
					: {}),
				hooks: {
					aroundToolCall: childCapabilities.aroundToolCall,
					onEvent: childCapabilities.onEvent,
				},
				onObserverError: resolvedAgentOptions.onObserverError,
			});
		} catch (error) {
			childSkills?.close();
			throw error;
		}
		const unsubscribe = child.subscribe((event) => {
			const activity = subagentActivity(event);
			if (activity) onActivity(activity);
		});
		const abortChild = () => child.abort();
		signal?.addEventListener("abort", abortChild, { once: true });

		try {
			signal?.throwIfAborted();
			const input = childSkills?.prepareInput(task).input ?? task;
			return finalAssistantText(await child.invoke(input));
		} finally {
			signal?.removeEventListener("abort", abortChild);
			unsubscribe();
			child.abort();
			await child.waitForIdle().catch(() => {});
			childSkills?.close();
		}
	});
	const primaryTools = [
		...(options.enabledTools?.has("UpdateTodos") === false ? [] : [updateTodosTool]),
		...(options.enabledTools?.has("SpawnAgent") === false ? [] : [spawnAgentTool]),
	];
	const capabilities = assembleAgentCapabilities({
		kind: "primary",
		executionContext: options.executionContext,
		toolOptions: options.tools,
		toolEnvironment,
		enabledTools: options.enabledTools,
		skills,
		mcp,
		attachments: options.executionContext.localFileAccess ? attachments : undefined,
		permissionMiddleware,
		extensionTools: options.extensionTools,
		extensionToolMiddleware: options.extensionToolMiddleware,
		extraTools: primaryTools,
		extraAroundToolCall: hooks?.aroundToolCall,
		extraOnEvent: hooks?.onEvent,
	});
	agent = new Agent<TAppState>({
		model,
		provider,
		tools: capabilities.tools,
		sessionHandle,
		instructions: resolvedInstructions,
		temperature: resolvedAgentOptions.temperature,
		maxTokens: resolvedAgentOptions.maxTokens,
		providerOptions: resolvedAgentOptions.providerOptions,
		maxIterations: resolvedAgentOptions.maxIterations,
		toolExecution: resolvedAgentOptions.toolExecution,
		compaction: resolvedAgentOptions.compaction,
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
	return new CodingAgent(
		agent,
		configStore,
		runtime,
		stopConfigWatch,
		skills,
		mcp,
		attachments,
		extensionToolCatalog,
		coreToolPermissions,
	);
}

async function createMcpRuntime(servers: readonly McpServer[]): Promise<McpRuntime | undefined> {
	if (servers.length === 0) return undefined;
	const result = await connectMcpServers({ namespace: "settings", servers });
	if (result.isOk()) return result.value;
	return {
		tools: [],
		diagnostics: [{ serverName: result.error.serverName, message: result.error.message }],
		close: async () => {},
	};
}

function createSkillsRuntime<TSchema extends TObject, TAppState extends JsonObject>(
	options: CreateCodingAgentOptions<TSchema, TAppState>,
	pluginSkills: CodingSkillsRuntimeOptions["pluginSkills"] = [],
): Promise<CodingSkillsRuntime | undefined> {
	if (options.skills === false) return Promise.resolve(undefined);
	return CodingSkillsRuntime.create({
		homeDirectory: options.skills?.homeDirectory ?? options.configOptions?.homeDir ?? homedir(),
		workspaceDirectory:
			options.skills?.workspaceDirectory ??
			(options.executionContext.localFileAccess ? options.executionContext.configRoot : undefined),
		workspaceTrusted:
			options.skills?.workspaceTrusted ??
			options.configOptions?.workspaceTrusted ??
			options.executionContext.localFileAccess,
		debounceMs: options.skills?.debounceMs,
		commandNames: options.skills?.commandNames,
		pluginSkills,
	});
}

function subagentActivity(event: AgentEvent) {
	return event.type === "tool_execution_start" ? event.toolName : undefined;
}

function finalAssistantText(messages: readonly AgentMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const text = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("")
			.trim();
		if (text) return text;
	}
	return "";
}

function defaultPermissionSettings<TSchema extends TObject>(snapshot: ConfigSnapshot<TSchema>): PermissionSettings {
	const settings = snapshot.settings as Readonly<Record<string, unknown>>;
	// Two complementary shapes, not two generations: `permissions` carries the mode and the
	// allow/ask/deny lists, `permission` carries the per-tool config tree. Both feed one settings object.
	const modeAndRules = isRecord(settings.permissions) ? (settings.permissions as PermissionSettings) : {};
	return isRecord(settings.permission)
		? { ...modeAndRules, permission: settings.permission as PermissionConfig }
		: modeAndRules;
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

function sessionTodosFromAppState(appState: JsonObject): SessionTodos | undefined {
	const value = appState.todos;
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		typeof value.updatedAt !== "number" ||
		!Number.isFinite(value.updatedAt)
	) {
		return undefined;
	}
	if (!Array.isArray(value.items) || value.items.length > 20) return undefined;
	const ids = new Set<string>();
	let inProgressCount = 0;
	const items = value.items.flatMap((candidate) => {
		if (!isRecord(candidate)) return [];
		const { id, content, status } = candidate;
		if (
			typeof id !== "string" ||
			!/^[A-Za-z0-9._-]{1,64}$/.test(id) ||
			ids.has(id) ||
			typeof content !== "string" ||
			content.length === 0 ||
			content.length > 200 ||
			(status !== "pending" && status !== "in_progress" && status !== "completed" && status !== "cancelled")
		) {
			return [];
		}
		ids.add(id);
		if (status === "in_progress") inProgressCount++;
		const item: SessionTodoItem = { id, content, status };
		return [item];
	});
	if (items.length !== value.items.length || inProgressCount > 1) return undefined;
	return { version: 1, updatedAt: value.updatedAt, items };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
