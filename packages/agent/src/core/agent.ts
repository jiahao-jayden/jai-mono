import { EventStream } from "@jai/ai";
import { agentLoop } from "./agent-loop";
import { type Session, toToolInfo } from "./session";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "./types";

export type AgentInput = string | AgentMessage | AgentMessage[];

/** 一次流式调用：可迭代过程事件，也可等待最终消息。 */
export interface AgentRun extends AsyncIterable<AgentEvent> {
	result(): Promise<AgentMessage[]>;
}

/** Agent 负责执行；Session 只用于恢复它持有的对话状态。 */
export interface AgentOptions extends Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages"> {
	instructions?: string;
	messages?: AgentMessage[];
	tools?: AgentTool[];
	session?: Session;
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
export class Agent {
	private readonly config: Omit<AgentLoopConfig, "getSteeringMessages" | "getFollowUpMessages">;
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
		assertModelMatchesProvider(options.model, options.provider);

		this.systemPrompt = options.instructions ?? options.session?.systemPrompt ?? "";
		this.messages = [...(options.session?.messages ?? options.messages ?? [])];
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

	/** 返回 wire-safe 状态；工具只保留元信息。 */
	getSession(): Session {
		return {
			systemPrompt: this.systemPrompt,
			messages: [...this.messages],
			tools: this.tools.map((tool) => toToolInfo(tool)),
			isRunning: this.isRunning,
			streamingMessage: this.streamingMessage,
			pendingToolCallIds: [...this.pendingToolCallIds],
			errorMessage: this.errorMessage,
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
		void this.startRun(input, (event) => output.push(event)).then(
			(messages) => output.end(messages),
			(error) => output.fail(error),
		);
		return output;
	}

	private startRun(input: AgentInput, emit?: (event: AgentEvent) => void): Promise<AgentMessage[]> {
		if (this.activeRun) {
			throw new Error("Agent is already running. Use steer() or followUp().");
		}

		const prompts = toMessages(input);
		const activeRun = this.createActiveRun();
		this.activeRun = activeRun;
		this.isRunning = true;
		this.streamingMessage = undefined;
		this.pendingToolCallIds = new Set();
		this.errorMessage = undefined;

		return this.processRun(prompts, activeRun, emit);
	}

	private async processRun(
		prompts: AgentMessage[],
		activeRun: ActiveRun,
		emit?: (event: AgentEvent) => void,
	): Promise<AgentMessage[]> {
		try {
			const stream = agentLoop(
				prompts,
				this.createContextSnapshot(),
				this.createLoopConfig(),
				activeRun.controller.signal,
			);

			for await (const event of stream) {
				this.reduce(event);
				emit?.(event);
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
	 * 状态归约器（reducer）：把 agentLoop 发出的事件转换成会话当前状态。
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

	/** 每次 run 都拿独立数组，loop 无法直接修改会话内部状态。 */
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
		this.isRunning = false;
		this.streamingMessage = undefined;
		this.pendingToolCallIds = new Set();

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
