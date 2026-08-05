import { homedir } from "node:os";
import {
	Agent,
	type AgentCompactionOptions,
	type AgentEvent,
	type AgentEventListener,
	type AgentExtension,
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
import type { CodingExecutionContext } from "../business/types";
import {
	type CodingConfigDefinition,
	CodingConfigStore,
	type CodingConfigStoreOptions,
	type ConfigSnapshot,
} from "../config";
import {
	createPermissionMiddleware,
	type PermissionApprovalDecision,
	type PermissionApprovalRequest,
	type PermissionSettings,
} from "../permissions";
import { CodingSkillsRuntime, type CodingSkillsRuntimeOptions } from "../skills";
import { type CodingToolOptions, createCodingTools, createReportProgressTool, createSpawnAgentTool } from "../tools";

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
	readonly extensions?: readonly AgentExtension[];
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
	readonly sessionDirectory: string;
	readonly appState?: TAppState;
	readonly instructions?: string;
	readonly resolveInstructions?: (snapshot: ConfigSnapshot<TSchema>) => string | Promise<string>;
	readonly configDefinition: CodingConfigDefinition<TSchema>;
	readonly configOptions?: Omit<CodingConfigStoreOptions, "projectRoot" | "workspaceRoot">;
	readonly resolveProvider: (
		snapshot: ConfigSnapshot<TSchema>,
	) => ResolvedCodingProvider | Promise<ResolvedCodingProvider>;
	readonly permissions?: CodingAgentPermissionOptions<TSchema>;
	readonly skills?: false | CodingAgentSkillsOptions;
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

	constructor(
		agent: Agent<TAppState>,
		configStore: CodingConfigStore<TSchema>,
		runtime: RuntimeState<TSchema>,
		stopConfigWatch: () => void,
		skills?: CodingSkillsRuntime,
	) {
		this.#agent = agent;
		this.configStore = configStore;
		this.#runtime = runtime;
		this.#stopConfigWatch = stopConfigWatch;
		this.#skills = skills;
	}

	get configSnapshot(): ConfigSnapshot<TSchema> {
		return this.#runtime.snapshot;
	}

	get state() {
		return this.#agent.state;
	}

	initialize(): Promise<void> {
		return this.#agent.initialize();
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
	const skills = await createSkillsRuntime(options);
	const sessionStore = new FileSessionStore<TAppState>(options.sessionDirectory);
	const sessionHandle = await openSession(sessionStore, options.sessionId, options.appState ?? ({} as TAppState));
	const selectPermissionSettings = options.permissions?.selectSettings ?? defaultPermissionSettings;
	const sessionAllowRules = new Set<string>();
	const hooks = resolvedAgentOptions.hooks;
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
				persistProjectLocalAllowRule: options.permissions?.persistProjectLocalAllowRule,
				pathCapabilities: toolEnvironment,
				sessionAllowRules,
			}),
		);
	}
	const spawnAgentTool = createSpawnAgentTool(async ({ task, signal, onActivity }) => {
		signal?.throwIfAborted();
		const childSkills = await createSkillsRuntime(options);
		const childAroundToolCall = options.executionContext.localFileAccess
			? [
					createPermissionMiddleware({
						workspaceRoot: options.executionContext.cwd,
						settings: () => selectPermissionSettings(runtime.snapshot),
						requestApproval: options.permissions?.requestApproval,
						persistProjectLocalAllowRule: options.permissions?.persistProjectLocalAllowRule,
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
					createReportProgressTool(),
					...(options.executionContext.localFileAccess
						? createCodingTools({ cwd: options.executionContext.cwd, ...options.tools }, toolEnvironment)
						: []),
				],
				instructions: [resolvedInstructions, SUBAGENT_INSTRUCTIONS].filter(Boolean).join("\n\n"),
				temperature: resolvedAgentOptions.temperature,
				maxTokens: resolvedAgentOptions.maxTokens,
				providerOptions: resolvedAgentOptions.providerOptions,
				maxIterations: resolvedAgentOptions.maxIterations,
				toolExecution: resolvedAgentOptions.toolExecution,
				compaction: resolvedAgentOptions.compaction,
				hooks: { aroundToolCall: childAroundToolCall },
				extensions: childSkills ? [childSkills.extension] : [],
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
	const agent = new Agent<TAppState>({
		model,
		provider,
		tools: [
			createReportProgressTool(),
			spawnAgentTool,
			...(options.executionContext.localFileAccess
				? createCodingTools({ cwd: options.executionContext.cwd, ...options.tools }, toolEnvironment)
				: []),
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
			aroundToolCall,
		},
		extensions: [...(skills ? [skills.extension] : []), ...(resolvedAgentOptions.extensions ?? [])],
		onObserverError: resolvedAgentOptions.onObserverError,
	});
	const stopConfigWatch = configStore.watch((event) => {
		if (!runtime.closed && event.status === "valid") runtime.snapshot = event.snapshot;
	});
	return new CodingAgent(agent, configStore, runtime, stopConfigWatch, skills);
}

function createSkillsRuntime<TSchema extends TObject, TAppState extends JsonObject>(
	options: CreateCodingAgentOptions<TSchema, TAppState>,
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
	return isRecord(permissions) ? (permissions as PermissionSettings) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
