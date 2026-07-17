import { agentLoop } from "./agent-loop";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "./types";

/** Agent 持有的会话状态与当前运行状态。 */
export interface AgentState {
	systemPrompt: string;
	messages: AgentMessage[];
	tools: AgentTool[];

	isRunning: boolean;
	streamingMessage?: AgentMessage;
	pendingToolCallIds: ReadonlySet<string>;
	errorMessage?: string;
}

/**
 * Agent 的配置选项。
 * 队列接入点由 Agent 自己提供，调用方只配置 loop 的静态策略。
 */
export interface AgentOptions {
	context: AgentContext;
	config: Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages">;
}

/** 事件先写入 AgentState，再按注册顺序通知 listener。 */
export type AgentListener = (event: AgentEvent, signal: AbortSignal) => void | Promise<void>;

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

export class Agent {
	private readonly config: AgentOptions["config"];
	private readonly listeners = new Set<AgentListener>();
	private readonly steeringQueue = new PendingMessageQueue();
	private readonly followUpQueue = new PendingMessageQueue();

	private systemPrompt: string;
	private messages: AgentMessage[];
	private tools: AgentTool[];

	private isRunning = false;
	private streamingMessage?: AgentMessage;
	private pendingToolCallIds = new Set<string>();
	private errorMessage?: string;
	private activeRun?: ActiveRun;

	constructor(options: AgentOptions) {
		this.systemPrompt = options.context.systemPrompt;
		this.messages = [...options.context.messages];
		this.tools = [...options.context.tools];
		this.config = {
			...options.config,
			toolMiddlewares: options.config.toolMiddlewares ? [...options.config.toolMiddlewares] : undefined,
		};
	}

	/**
	 * 返回浅快照，避免调用方直接修改 Agent 内部数组或 Set。
	 */
	get state(): AgentState {
		return {
			systemPrompt: this.systemPrompt,
			messages: [...this.messages],
			tools: [...this.tools],
			isRunning: this.isRunning,
			streamingMessage: this.streamingMessage,
			pendingToolCallIds: new Set(this.pendingToolCallIds),
			errorMessage: this.errorMessage,
		};
	}

	/** 当前 run 的中断信号；空闲时为 undefined。 */
	get signal(): AbortSignal | undefined {
		return this.activeRun?.controller.signal;
	}

	/**
	 * 订阅 AgentEvent。
	 */
	subscribe(listener: AgentListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async prompt(input: AgentMessage | AgentMessage[]): Promise<AgentMessage[]> {
		if (this.activeRun) {
			throw new Error("Agent is already running. Use steer() or followUp().");
		}

		const prompts = Array.isArray(input) ? input : [input];
		const activeRun = this.createActiveRun();
		this.activeRun = activeRun;
		this.isRunning = true;
		this.streamingMessage = undefined;
		this.pendingToolCallIds = new Set();
		this.errorMessage = undefined;

		let listenerError: unknown;
		try {
			const stream = agentLoop(
				prompts,
				this.createContextSnapshot(),
				this.createLoopConfig(),
				activeRun.controller.signal,
			);

			for await (const event of stream) {
				this.reduce(event);
				if (listenerError === undefined) {
					try {
						await this.notify(event, activeRun.controller.signal);
					} catch (error) {
						listenerError = error;
						activeRun.controller.abort();
					}
				}
			}

			const message = await stream.result();
			if (listenerError !== undefined) {
				throw listenerError;
			}
			return message;
		} finally {
			this.finishRun(activeRun);
		}
	}

	/**
	 * 把消息排到当前 task 的下一个 turn 中。
	 */
	steer(message: AgentMessage): void {
		this.assertActiveRun();
		this.steeringQueue.enqueue(message);
	}

	/**
	 * 把消息排到当前 task 自然结束后的下一个 task 中。
	 */
	followUp(message: AgentMessage): void {
		this.assertActiveRun();
		this.followUpQueue.enqueue(message);
	}

	/**
	 * 中断当前 run：空闲时调用不会产生效果
	 */
	abort(): void {
		this.activeRun?.controller.abort();
	}

	/** 等待当前 run、事件 reducer 和 listeners 全部完成。 */
	waitForIdle(): Promise<void> {
		return this.activeRun?.done ?? Promise.resolve();
	}

	/**
	 * 清空 transcript 与运行残留。
	 * 运行中 reset 会破坏 loop 使用的上下文，因此直接拒绝。
	 */
	reset(): void {
		if (this.activeRun) {
			throw new Error("Cannot reset Agent while a run is active.");
		}

		this.messages = [];
		this.streamingMessage = undefined;
		this.pendingToolCallIds = new Set();
		this.errorMessage = undefined;
		this.steeringQueue.clear();
		this.followUpQueue.clear();
	}

	/**
	 * 状态归约器（reducer）：把 agentLoop 发出的事件转换成 Agent 当前状态。
	 */
	private reduce(event: AgentEvent): void {
		switch (event.type) {
			case "message_start":
			case "message_update":
				this.streamingMessage = event.message;
				break;

			case "message_end":
				this.streamingMessage = undefined;
				this.messages.push(event.message);
				break;

			case "tool_execution_start": {
				const pending = new Set(this.pendingToolCallIds);
				pending.add(event.toolCallId);
				this.pendingToolCallIds = pending;
				break;
			}

			case "tool_execution_end": {
				const pending = new Set(this.pendingToolCallIds);
				pending.delete(event.toolCallId);
				this.pendingToolCallIds = pending;
				break;
			}

			case "turn_end":
				this.errorMessage = event.message.errorMessage;
				break;

			case "agent_end":
				this.streamingMessage = undefined;
				break;
		}
	}

	/** 每次 run 都拿独立数组，loop 无法直接修改 Agent 内部状态。 */
	private createContextSnapshot(): AgentContext {
		return {
			systemPrompt: this.systemPrompt,
			messages: [...this.messages],
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

	/** listener 串行执行，保证观察顺序与事件顺序一致。 */
	private async notify(event: AgentEvent, signal: AbortSignal): Promise<void> {
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}

	private assertActiveRun(): void {
		if (!this.activeRun) {
			throw new Error("Agent is idle. Start a prompt instead.");
		}
	}

	/**
	 * 创建一个活跃的运行实例。
	 */
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
		this.isRunning = false;
		this.streamingMessage = undefined;
		this.pendingToolCallIds = new Set();

		if (this.activeRun === activeRun) {
			this.activeRun = undefined;
		}
		activeRun.resolveDone();
	}
}
