import { homedir } from "node:os";
import path from "node:path";
import {
	Agent,
	type AgentCompactionOptions,
	type AgentEvent,
	type AgentEventListener,
	type AgentHookMap,
	type AgentInput,
	type AgentMessage,
	type AgentRun,
	type JsonObject,
	type ObserverErrorInfo,
	openSession,
	type ToolExecutionMode,
} from "@jai/agent";
import { FileSessionStore, NodeExecutionEnvironment } from "@jai/agent/node";
import type { Model, Provider } from "@jai/ai";
import type { TObject } from "@sinclair/typebox";
import { type AgentPluginDiagnostic, type AgentPluginRuntime, createAgentPluginRuntime } from "../agent-plugins";
import type { CodingExecutionContext } from "../business/types";
import {
	type CodingConfigDefinition,
	CodingConfigStore,
	type CodingConfigStoreOptions,
	type ConfigSnapshot,
	type ResolvedCodingSettings,
} from "../config";
import {
	createPermissionMiddleware,
	type PermissionAction,
	type PermissionApprovalDecision,
	type PermissionApprovalRequest,
	type PermissionConfig,
	type PermissionSettings,
} from "../permissions";
import { CodingSkillsRuntime, type CodingSkillsRuntimeOptions } from "../skills";
import {
	type CodingToolOptions,
	createCodingTools,
	createSpawnAgentTool,
	createUpdateTodosTool,
	type SessionTodoItem,
	type SessionTodos,
} from "../tools";

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
	readonly persistProjectLocalAllowRule?: (rule: string) => void | Promise<void>;
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

export interface CodingAgentPluginsOptions {
	readonly directories: readonly string[];
	readonly dataDirectory?: string;
	readonly scope?: "user" | "project";
}

export interface CreateCodingAgentOptions<TSchema extends TObject, TAppState extends JsonObject = JsonObject> {
	readonly executionContext: CodingExecutionContext;
	readonly sessionId: string;
	readonly sessionDirectory: string;
	readonly appState?: TAppState;
	readonly instructions?: string;
	readonly resolveInstructions?: (snapshot: ConfigSnapshot<TSchema>) => string | Promise<string>;
	readonly configDefinition: CodingConfigDefinition<TSchema>;
	readonly configOptions?: Omit<CodingConfigStoreOptions, "projectRoot">;
	readonly resolveProvider: (
		snapshot: ConfigSnapshot<TSchema>,
	) => ResolvedCodingProvider | Promise<ResolvedCodingProvider>;
	readonly permissions?: CodingAgentPermissionOptions<TSchema>;
	readonly skills?: false | CodingAgentSkillsOptions;
	readonly agentPlugins?: false | CodingAgentPluginsOptions;
	readonly tools?: Omit<CodingToolOptions, "cwd">;
	readonly agent?: CodingAgentRuntimeOptions;
	readonly resolveAgentOptions?: (
		snapshot: ConfigSnapshot<TSchema>,
		resolved: ResolvedCodingProvider,
	) => CodingAgentRuntimeOptions | Promise<CodingAgentRuntimeOptions>;
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
	readonly #plugins?: AgentPluginRuntime;

	constructor(
		agent: Agent<TAppState>,
		configStore: CodingConfigStore<TSchema>,
		runtime: RuntimeState<TSchema>,
		stopConfigWatch: () => void,
		skills?: CodingSkillsRuntime,
		plugins?: AgentPluginRuntime,
	) {
		this.#agent = agent;
		this.configStore = configStore;
		this.#runtime = runtime;
		this.#stopConfigWatch = stopConfigWatch;
		this.#skills = skills;
		this.#plugins = plugins;
	}

	get configSnapshot(): ConfigSnapshot<TSchema> {
		return this.#runtime.snapshot;
	}

	get state() {
		return this.#agent.state;
	}

	get pluginDiagnostics(): readonly AgentPluginDiagnostic[] {
		return this.#plugins?.diagnostics ?? [];
	}

	invoke(input: AgentInput): Promise<AgentMessage[]> {
		return this.#agent.invoke(this.#skills?.prepareInput(input).input ?? input);
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

	close(): void {
		if (this.#runtime.closed) return;
		this.#runtime.closed = true;
		this.#agent.abort();
		this.#stopConfigWatch();
		this.#skills?.close();
		void this.#plugins?.close();
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
	const plugins = await createPluginRuntime(options);
	let skills: CodingSkillsRuntime | undefined;
	try {
		skills = await createSkillsRuntime(options, plugins?.skills);
	} catch (error) {
		await plugins?.close();
		throw error;
	}
	const sessionStore = new FileSessionStore<TAppState>(options.sessionDirectory);
	const sessionHandle = await openSession(sessionStore, options.sessionId, options.appState ?? ({} as TAppState));
	const selectPermissionSettings = options.permissions?.selectSettings ?? defaultPermissionSettings;
	const sessionAllowRules = new Set<string>();
	const persistSingleProjectLocalAllowRule = options.permissions?.persistProjectLocalAllowRule;
	const persistProjectLocalAllowRules =
		options.permissions?.persistProjectLocalAllowRules ??
		(persistSingleProjectLocalAllowRule
			? async (rules: readonly string[]) => {
					for (const rule of rules) await persistSingleProjectLocalAllowRule(rule);
				}
			: undefined) ??
		(async (rules: readonly string[]) => {
			const next = await persistBashAllowRules(configStore, rules);
			if (next) runtime.snapshot = next;
		});
	let agent!: Agent<TAppState>;
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
	const aroundToolCall = [...(hooks?.aroundToolCall ?? [])];
	const toolEnvironment = options.executionContext.localFileAccess
		? new NodeExecutionEnvironment({
				cwd: options.executionContext.cwd,
				shellPath: options.tools?.shell,
				ripgrepPath: options.tools?.ripgrepPath,
			})
		: undefined;
	if (options.executionContext.localFileAccess) {
		aroundToolCall.push(
			createPermissionMiddleware({
				workspaceRoot: options.executionContext.cwd,
				settings: () => selectPermissionSettings(runtime.snapshot),
				requestApproval: options.permissions?.requestApproval,
				persistProjectLocalAllowRules,
				pathCapabilities: toolEnvironment,
				sessionAllowRules,
			}),
		);
	}
	const spawnAgentTool = createSpawnAgentTool(async ({ task, signal, onActivity }) => {
		signal?.throwIfAborted();
		const childSkills = await createSkillsRuntime(options, plugins?.skills);
		const childAroundToolCall = options.executionContext.localFileAccess
			? [
					createPermissionMiddleware({
						workspaceRoot: options.executionContext.cwd,
						settings: () => selectPermissionSettings(runtime.snapshot),
						requestApproval: options.permissions?.requestApproval,
						persistProjectLocalAllowRules,
						pathCapabilities: toolEnvironment,
						sessionAllowRules,
					}),
				]
			: [];
		let child: Agent;
		try {
			child = new Agent({
				model,
				provider,
				tools: [
					...(options.executionContext.localFileAccess
						? createCodingTools({ cwd: options.executionContext.cwd, ...options.tools }, toolEnvironment)
						: []),
					...(childSkills ? [childSkills.tool] : []),
					...(plugins?.tools ?? []),
				],
				instructions: [resolvedInstructions, SUBAGENT_INSTRUCTIONS].filter(Boolean).join("\n\n"),
				temperature: resolvedAgentOptions.temperature,
				maxTokens: resolvedAgentOptions.maxTokens,
				providerOptions: resolvedAgentOptions.providerOptions,
				maxIterations: resolvedAgentOptions.maxIterations,
				toolExecution: resolvedAgentOptions.toolExecution,
				compaction: resolvedAgentOptions.compaction,
				hooks: {
					aroundToolCall: childAroundToolCall,
					onEvent: childSkills ? [childSkills.onEvent] : [],
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
	agent = new Agent<TAppState>({
		model,
		provider,
		tools: [
			updateTodosTool,
			spawnAgentTool,
			...(options.executionContext.localFileAccess
				? createCodingTools({ cwd: options.executionContext.cwd, ...options.tools }, toolEnvironment)
				: []),
			...(skills ? [skills.tool] : []),
			...(plugins?.tools ?? []),
		],
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
			aroundToolCall,
			onEvent: [...(hooks?.onEvent ?? []), ...(skills ? [skills.onEvent] : [])],
		},
		onObserverError: resolvedAgentOptions.onObserverError,
	});
	const stopConfigWatch = configStore.watch((event) => {
		if (!runtime.closed && event.status === "valid") runtime.snapshot = event.snapshot;
	});
	return new CodingAgent(agent, configStore, runtime, stopConfigWatch, skills, plugins);
}

async function createPluginRuntime<TSchema extends TObject, TAppState extends JsonObject>(
	options: CreateCodingAgentOptions<TSchema, TAppState>,
): Promise<AgentPluginRuntime | undefined> {
	if (options.agentPlugins === undefined || options.agentPlugins === false) return undefined;
	return createAgentPluginRuntime({
		directories: options.agentPlugins.directories,
		dataDirectory:
			options.agentPlugins.dataDirectory ??
			path.join(options.configOptions?.homeDir ?? homedir(), ".jai", "agent-plugin-data"),
		scope: options.agentPlugins.scope,
	});
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
	return event.type === "tool_execution_start" ? event.title : undefined;
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
	const permissions = settings.permissions;
	const legacy = isRecord(permissions) ? (permissions as PermissionSettings) : {};
	return isRecord(settings.permission) ? { ...legacy, permission: settings.permission as PermissionConfig } : legacy;
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
