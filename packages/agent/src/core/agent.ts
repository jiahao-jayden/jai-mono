import { EventStream } from "@jai/ai";
import { TaggedError } from "better-result";
import { agentLoop } from "./agent-loop";
import { type AgentState, cloneJson, freezeState, type JsonObject, type MutableAgentState } from "./agent-state";
import { type Session, toToolInfo } from "./session";
import type {
	AgentContext,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	CoreAgentEvent,
	EventRun,
	ObserverErrorInfo,
} from "./types";

export type AgentInput = string | AgentMessage | AgentMessage[];

type AgentErrorInit = { readonly message: string };
class AgentAlreadyRunning extends TaggedError("agent.already_running")<AgentErrorInit> {}
class AgentResetWhileRunning extends TaggedError("agent.reset_while_running")<AgentErrorInit> {}
class AgentIdle extends TaggedError("agent.idle")<AgentErrorInit> {}
class AgentModelProviderMismatch extends TaggedError("agent.model_provider_mismatch")<AgentErrorInit> {}
class AgentDuplicateTool extends TaggedError("agent.duplicate_tool")<AgentErrorInit> {}

function agentError(
	reason: "already_running" | "reset_while_running" | "idle" | "model_provider_mismatch" | "duplicate_tool",
	init: AgentErrorInit,
) {
	switch (reason) {
		case "already_running":
			return new AgentAlreadyRunning(init);
		case "reset_while_running":
			return new AgentResetWhileRunning(init);
		case "idle":
			return new AgentIdle(init);
		case "model_provider_mismatch":
			return new AgentModelProviderMismatch(init);
		case "duplicate_tool":
			return new AgentDuplicateTool(init);
	}
}

/** 观察者：读事件，不影响 run。抛错会被隔离并交给 onObserverError。 */
export type CoreAgentEventListener = (event: CoreAgentEvent) => void | Promise<void>;

export type CoreAgentRun = EventRun<CoreAgentEvent, AgentMessage[]>;

/** CoreAgent 负责执行；Session 只用于恢复它持有的对话状态。 */
export interface CoreAgentOptions<TAppState extends JsonObject = JsonObject>
	extends Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages"> {
	instructions?: string;
	messages?: AgentMessage[];
	/** 业务状态：跨调用持久化，默认不进入模型上下文。 */
	appState?: TAppState;
	tools?: AgentTool[];
	session?: Session<TAppState>;
	/**
	 * 关键副作用出口（例如持久化）：状态归约之后、观察者之前调用。
	 * 与 subscribe() 不同，它失败会让整次 run 失败。
	 */
	commitEvent?: (event: CoreAgentEvent) => void | Promise<void>;
	/** 观察者失败的上报口；不提供则忽略。它自身抛错同样被吞掉。 */
	onObserverError?: (info: ObserverErrorInfo<CoreAgentEvent>) => void;
}

interface ActiveRun {
	controller: AbortController;
	done: Promise<void>;
	resolveDone: () => void;
}

class PendingMessageQueue {
	private messages: AgentMessage[] = [];

	enqueue(message: AgentMessage): void {
		this.messages.push(message);
	}

	drainOne(): AgentMessage[] {
		const message = this.messages.shift();
		return message ? [message] : [];
	}

	clear(): void {
		this.messages = [];
	}
}

/** 在进程内调用 LLM、执行工具，并维护一段对话状态。 */
export class CoreAgent<TAppState extends JsonObject = JsonObject> {
	private readonly config: Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages">;
	private readonly steeringQueue = new PendingMessageQueue();
	private readonly followUpQueue = new PendingMessageQueue();
	private readonly listeners = new Set<CoreAgentEventListener>();
	private readonly commitEvent?: (event: CoreAgentEvent) => void | Promise<void>;
	private readonly onObserverError?: (info: ObserverErrorInfo<CoreAgentEvent>) => void;

	private readonly internalState: MutableAgentState<TAppState>;
	private tools: AgentTool[];
	private activeRun?: ActiveRun;

	constructor(options: CoreAgentOptions<TAppState>) {
		assertModelMatchesProvider(options.model, options.provider);

		const appState = options.appState ?? options.session?.appState ?? ({} as TAppState);
		this.internalState = {
			systemPrompt: options.instructions ?? options.session?.systemPrompt ?? "",
			messages: [...(options.session?.messages ?? options.messages ?? [])],
			appState: cloneJson(appState),
			isRunning: false,
			pendingToolCallIds: new Set(),
		};
		this.tools = assertUniqueTools(options.tools ?? []);
		this.commitEvent = options.commitEvent;
		this.onObserverError = options.onObserverError;
		this.config = {
			model: options.model,
			provider: options.provider,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			providerOptions: options.providerOptions,
			maxIterations: options.maxIterations,
			toolExecution: options.toolExecution,
			toolMiddlewares: options.toolMiddlewares ? [...options.toolMiddlewares] : undefined,
			prepareContext: options.prepareContext,
			onModelError: options.onModelError,
		};
	}

	/** 当前状态的防御性副本。 */
	get state(): AgentState<TAppState> {
		return freezeState(this.internalState);
	}

	/** 返回 wire-safe 状态；工具只保留元信息。 */
	getSession(): Session<TAppState> {
		const state = this.internalState;
		return {
			systemPrompt: state.systemPrompt,
			messages: [...state.messages],
			appState: cloneJson(state.appState),
			tools: this.tools.map((tool) => toToolInfo(tool)),
			isRunning: state.isRunning,
			streamingMessage: state.streamingMessage,
			pendingToolCallIds: [...state.pendingToolCallIds],
			error: state.error ? structuredClone(state.error) : undefined,
		};
	}

	setAppState(next: TAppState): void {
		this.internalState.appState = cloneJson(next);
	}

	updateAppState(update: (current: TAppState) => TAppState): void {
		this.setAppState(update(cloneJson(this.internalState.appState)));
	}

	/** 观察入口：UI 与日志挂在这里。需要失败即终止 run 的副作用请用 commitEvent。 */
	subscribe(listener: CoreAgentEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	get signal(): AbortSignal | undefined {
		return this.activeRun?.controller.signal;
	}

	invoke(input: AgentInput): Promise<AgentMessage[]> {
		return this.startRun(input);
	}

	stream(input: AgentInput): CoreAgentRun {
		const output = new EventStream<CoreAgentEvent, AgentMessage[]>(
			() => false,
			() => [],
		);
		const unsubscribe = this.subscribe((event) => {
			output.push(event);
		});

		let run: Promise<AgentMessage[]>;
		try {
			run = this.startRun(input);
		} catch (error) {
			unsubscribe();
			throw error;
		}

		void run
			.then(
				(messages) => output.end(messages),
				(error) => output.fail(error),
			)
			.finally(unsubscribe);

		return output;
	}

	private startRun(input: AgentInput): Promise<AgentMessage[]> {
		if (this.activeRun) {
			throw agentError("already_running", { message: "Agent is already running. Use steer() or followUp()." });
		}

		const prompts = toMessages(input);
		const activeRun = this.createActiveRun();
		this.activeRun = activeRun;
		this.internalState.isRunning = true;
		this.internalState.streamingMessage = undefined;
		this.internalState.pendingToolCallIds = new Set();
		this.internalState.error = undefined;

		return this.processRun(prompts, activeRun);
	}

	private async processRun(prompts: AgentMessage[], activeRun: ActiveRun): Promise<AgentMessage[]> {
		try {
			const stream = agentLoop(
				prompts,
				this.createContextSnapshot(),
				this.createLoopConfig(),
				activeRun.controller.signal,
			);

			for await (const event of stream) {
				this.reduce(event);
				await this.commitEvent?.(event);
				await this.publish(event);
			}

			return await stream.result();
		} finally {
			this.finishRun(activeRun);
		}
	}

	steer(message: AgentMessage): void {
		this.assertActiveRun();
		this.steeringQueue.enqueue(message);
	}

	followUp(message: AgentMessage): void {
		this.assertActiveRun();
		this.followUpQueue.enqueue(message);
	}

	abort(): void {
		this.activeRun?.controller.abort();
	}

	waitForIdle(): Promise<void> {
		return this.activeRun?.done ?? Promise.resolve();
	}

	/**
	 * 清空 transcript 与运行残留；appState 属于业务状态，不受影响。
	 * 运行中 reset 会破坏 loop 使用的上下文，因此直接拒绝。
	 */
	reset(): void {
		if (this.activeRun) {
			throw agentError("reset_while_running", { message: "Cannot reset Agent while a run is active." });
		}

		this.internalState.messages = [];
		this.internalState.streamingMessage = undefined;
		this.internalState.pendingToolCallIds = new Set();
		this.internalState.error = undefined;
		this.steeringQueue.clear();
		this.followUpQueue.clear();
	}

	/**
	 * 状态与关键副作用都完成后才分发，监听器因此总能读到与事件一致的 state。
	 * 逐个隔离：一个观察者出错不影响其余观察者，也不影响 run 的结果。
	 */
	private async publish(event: CoreAgentEvent): Promise<void> {
		for (const listener of [...this.listeners]) {
			try {
				await listener(event);
			} catch (error) {
				this.reportObserverError(error, event);
			}
		}
	}

	private reportObserverError(error: unknown, event: CoreAgentEvent): void {
		try {
			this.onObserverError?.({ error, event });
		} catch {
			// 上报本身失败没有更上层可以处理，只能停在这里，不能反过来影响 run。
		}
	}

	/**
	 * 状态归约器（reducer）：把 agentLoop 发出的事件转换成会话当前状态。
	 */
	private reduce(event: CoreAgentEvent): void {
		const state = this.internalState;

		switch (event.type) {
			case "message_start":
			case "message_update":
				state.streamingMessage = event.message;
				break;

			case "message_end":
				state.streamingMessage = undefined;
				state.messages.push(event.message);
				break;

			case "tool_execution_start": {
				const pending = new Set(state.pendingToolCallIds);
				pending.add(event.toolCallId);
				state.pendingToolCallIds = pending;
				break;
			}

			case "tool_execution_end": {
				const pending = new Set(state.pendingToolCallIds);
				pending.delete(event.toolCallId);
				state.pendingToolCallIds = pending;
				break;
			}

			case "turn_end":
				state.error = event.message.error ? structuredClone(event.message.error) : undefined;
				break;

			case "agent_end":
				state.streamingMessage = undefined;
				break;
		}
	}

	/** 每次 run 都拿独立数组，loop 无法直接修改会话内部状态。 */
	private createContextSnapshot(): AgentContext {
		return {
			systemPrompt: this.internalState.systemPrompt,
			messages: [...this.internalState.messages],
			tools: [...this.tools],
		};
	}

	/** 把两个内存队列接到规定的 drain point。 */
	private createLoopConfig(): AgentLoopConfig {
		return {
			...this.config,
			getSteeringMessages: () => this.steeringQueue.drainOne(),
			getFollowUpMessages: () => this.followUpQueue.drainOne(),
		};
	}

	private assertActiveRun(): void {
		if (!this.activeRun) {
			throw agentError("idle", { message: "Agent is idle. Start an invocation instead." });
		}
	}

	private createActiveRun(): ActiveRun {
		const controller = new AbortController();
		let resolveDone = () => {};
		const done = new Promise<void>((resolve) => {
			resolveDone = resolve;
		});
		return {
			controller,
			done,
			resolveDone,
		};
	}

	/**
	 * 所有退出路径都经过 finally；先恢复状态，再唤醒 waitForIdle。
	 */
	private finishRun(activeRun: ActiveRun): void {
		this.internalState.isRunning = false;
		this.internalState.streamingMessage = undefined;
		this.internalState.pendingToolCallIds = new Set();

		if (this.activeRun === activeRun) {
			this.activeRun = undefined;
		}
		activeRun.resolveDone();
	}
}

function assertModelMatchesProvider(model: CoreAgentOptions["model"], provider: CoreAgentOptions["provider"]): void {
	if (model.provider !== provider.id) {
		throw agentError("model_provider_mismatch", {
			message: `Model "${model.id}" belongs to provider "${model.provider}", not "${provider.id}"`,
		});
	}
}

/** 工具保持给定顺序，但名字必须唯一。 */
function assertUniqueTools(tools: AgentTool[]): AgentTool[] {
	const seen = new Set<string>();
	for (const tool of tools) {
		if (seen.has(tool.name)) {
			throw agentError("duplicate_tool", { message: `Duplicate tool name "${tool.name}"` });
		}
		seen.add(tool.name);
	}
	return [...tools];
}

function toMessages(input: AgentInput): AgentMessage[] {
	const messages = Array.isArray(input) ? input : [input];
	const timestamp = Date.now();
	return messages.map((message) =>
		typeof message === "string"
			? {
					role: "user",
					content: message,
					timestamp,
				}
			: message,
	);
}
