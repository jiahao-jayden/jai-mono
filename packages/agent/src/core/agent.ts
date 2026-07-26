import { EventStream } from "@jai/ai";
import { agentLoop } from "./agent-loop";
import { type AgentState, cloneJson, freezeState, type JsonObject, type MutableAgentState } from "./agent-state";
import { type Session, toToolInfo } from "./session";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "./types";

export type AgentInput = string | AgentMessage | AgentMessage[];

/** 事件监听器；返回 Promise 时 loop 会等待它，失败则整次 run 失败。 */
export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;

/** 一次流式调用：可迭代过程事件，也可等待最终消息。 */
export interface AgentRun extends AsyncIterable<AgentEvent> {
	result(): Promise<AgentMessage[]>;
}

/** Agent 负责执行；Session 只用于恢复它持有的对话状态。 */
export interface AgentOptions<TAppState extends JsonObject = JsonObject>
	extends Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages"> {
	instructions?: string;
	messages?: AgentMessage[];
	/** 业务状态：跨调用持久化，默认不进入模型上下文。 */
	appState?: TAppState;
	tools?: AgentTool[];
	session?: Session<TAppState>;
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
export class Agent<TAppState extends JsonObject = JsonObject> {
	private readonly config: Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages">;
	private readonly steeringQueue = new PendingMessageQueue();
	private readonly followUpQueue = new PendingMessageQueue();
	private readonly listeners = new Set<AgentEventListener>();

	private readonly internalState: MutableAgentState<TAppState>;
	private tools: AgentTool[];
	private activeRun?: ActiveRun;

	constructor(options: AgentOptions<TAppState>) {
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
		this.config = {
			model: options.model,
			provider: options.provider,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			toolExecution: options.toolExecution,
			toolMiddlewares: options.toolMiddlewares ? [...options.toolMiddlewares] : undefined,
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
			errorMessage: state.errorMessage,
		};
	}

	setAppState(next: TAppState): void {
		this.internalState.appState = cloneJson(next);
	}

	updateAppState(update: (current: TAppState) => TAppState): void {
		this.setAppState(update(cloneJson(this.internalState.appState)));
	}

	/** 唯一的事件出口：UI、持久化与日志都挂在这里。 */
	subscribe(listener: AgentEventListener): () => void {
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

	stream(input: AgentInput): AgentRun {
		const output = createAgentRun();
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
			throw new Error("Agent is already running. Use steer() or followUp().");
		}

		const prompts = toMessages(input);
		const activeRun = this.createActiveRun();
		this.activeRun = activeRun;
		this.internalState.isRunning = true;
		this.internalState.streamingMessage = undefined;
		this.internalState.pendingToolCallIds = new Set();
		this.internalState.errorMessage = undefined;

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
				await this.notify(event);
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
			throw new Error("Cannot reset Agent while a run is active.");
		}

		this.internalState.messages = [];
		this.internalState.streamingMessage = undefined;
		this.internalState.pendingToolCallIds = new Set();
		this.internalState.errorMessage = undefined;
		this.steeringQueue.clear();
		this.followUpQueue.clear();
	}

	/** 状态先更新，再分发；监听器因此总能读到与事件一致的 state。 */
	private async notify(event: AgentEvent): Promise<void> {
		for (const listener of [...this.listeners]) {
			await listener(event);
		}
	}

	/**
	 * 状态归约器（reducer）：把 agentLoop 发出的事件转换成会话当前状态。
	 */
	private reduce(event: AgentEvent): void {
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
				state.errorMessage = event.message.errorMessage;
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
			throw new Error("Agent is idle. Start an invocation instead.");
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

function createAgentRun(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		() => false,
		() => [],
	);
}

function assertModelMatchesProvider(model: AgentOptions["model"], provider: AgentOptions["provider"]): void {
	if (model.provider !== provider.id) {
		throw new Error(`Model "${model.id}" belongs to provider "${model.provider}", not "${provider.id}"`);
	}
}

/** 工具保持给定顺序，但名字必须唯一。 */
function assertUniqueTools(tools: AgentTool[]): AgentTool[] {
	const seen = new Set<string>();
	for (const tool of tools) {
		if (seen.has(tool.name)) {
			throw new Error(`Duplicate tool name "${tool.name}"`);
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
