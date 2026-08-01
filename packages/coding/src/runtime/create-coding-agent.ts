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
import { type CodingToolOptions, createCodingTools } from "../tools";

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
	readonly toolExecution?: ToolExecutionMode;
	readonly compaction?: AgentCompactionOptions;
	readonly hooks?: AgentHookMap;
	readonly onObserverError?: (info: ObserverErrorInfo<AgentEvent>) => void;
}

export interface CreateCodingAgentOptions<TSchema extends TObject, TAppState extends JsonObject = JsonObject> {
	readonly executionContext: CodingExecutionContext;
	readonly sessionId: string;
	readonly sessionDirectory: string;
	readonly appState?: TAppState;
	readonly instructions?: string;
	readonly configDefinition: CodingConfigDefinition<TSchema>;
	readonly configOptions?: Omit<CodingConfigStoreOptions, "projectRoot" | "workspaceRoot">;
	readonly resolveProvider: (
		snapshot: ConfigSnapshot<TSchema>,
	) => ResolvedCodingProvider | Promise<ResolvedCodingProvider>;
	readonly permissions?: CodingAgentPermissionOptions<TSchema>;
	readonly tools?: Omit<CodingToolOptions, "cwd">;
	readonly agent?: CodingAgentRuntimeOptions;
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

	constructor(
		agent: Agent<TAppState>,
		configStore: CodingConfigStore<TSchema>,
		runtime: RuntimeState<TSchema>,
		stopConfigWatch: () => void,
	) {
		this.#agent = agent;
		this.configStore = configStore;
		this.#runtime = runtime;
		this.#stopConfigWatch = stopConfigWatch;
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
		return this.#agent.invoke(input);
	}

	stream(input: AgentInput): AgentRun {
		return this.#agent.stream(input);
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
	const sessionStore = new FileSessionStore<TAppState>(options.sessionDirectory);
	const sessionHandle = await openSession(sessionStore, options.sessionId, options.appState ?? ({} as TAppState));
	const selectPermissionSettings = options.permissions?.selectSettings ?? defaultPermissionSettings;
	const hooks = options.agent?.hooks;
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
			}),
		);
	}
	const agent = new Agent<TAppState>({
		model,
		provider,
		tools: options.executionContext.localFileAccess
			? createCodingTools({ cwd: options.executionContext.cwd, ...options.tools }, toolEnvironment)
			: [],
		sessionHandle,
		instructions: options.instructions,
		temperature: options.agent?.temperature,
		maxTokens: options.agent?.maxTokens,
		toolExecution: options.agent?.toolExecution,
		compaction: options.agent?.compaction,
		hooks: {
			...hooks,
			aroundToolCall,
		},
		onObserverError: options.agent?.onObserverError,
	});
	const stopConfigWatch = configStore.watch((event) => {
		if (!runtime.closed && event.status === "valid") runtime.snapshot = event.snapshot;
	});
	return new CodingAgent(agent, configStore, runtime, stopConfigWatch);
}

function defaultPermissionSettings<TSchema extends TObject>(snapshot: ConfigSnapshot<TSchema>): PermissionSettings {
	const settings = snapshot.settings as Readonly<Record<string, unknown>>;
	const permissions = settings.permissions;
	return isRecord(permissions) ? (permissions as PermissionSettings) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
