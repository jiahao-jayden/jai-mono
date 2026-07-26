import { EventStream } from "@jai/ai";
import { Agent, type AgentEventListener, type AgentInput, type AgentOptions, type AgentRun } from "../core/agent";
import { type AgentState, cloneJson, type JsonObject } from "../core/agent-state";
import type { Session } from "../core/session";
import type { AgentContext, AgentEvent, AgentMessage } from "../core/types";
import { type PromptSlot, renderPrompt } from "./prompt";
import { restoreFromSnapshot } from "./session/agent-binding";
import type { SessionHandle } from "./session/types";

type AgentHarnessCommonOptions<TAppState extends JsonObject> = Omit<
	AgentOptions<TAppState>,
	"session" | "instructions" | "messages" | "appState" | "prepareContext"
> & {
	promptSlots?: readonly PromptSlot[];
};

/**
 * 要么给一个已打开的 SessionHandle，由门面从它的 snapshot 恢复 durable 初值，
 * 要么自己传 durable 初值。两者同时给会出现两个事实来源，因此类型上直接禁止。
 */
export type AgentHarnessOptions<TAppState extends JsonObject = JsonObject> =
	| (AgentHarnessCommonOptions<TAppState> & {
			sessionHandle: SessionHandle<TAppState>;
			session?: never;
			instructions?: never;
			messages?: never;
			appState?: never;
	  })
	| (AgentHarnessCommonOptions<TAppState> & {
			sessionHandle?: undefined;
			session?: Session<TAppState>;
			instructions?: string;
			messages?: AgentMessage[];
			appState?: TAppState;
	  });

/**
 * 默认装配：恢复 session、注入动态 Prompt、把 durable 事件写回 store。
 * 内部只持有一个 Agent，执行语义（steering、abort、reducer）仍然只有 core 一份实现。
 */
export class AgentHarness<TAppState extends JsonObject = JsonObject> {
	private readonly agent: Agent<TAppState>;
	private readonly listeners = new Set<AgentEventListener>();
	private readonly promptSlots: readonly PromptSlot[];
	private readonly sessionHandle?: SessionHandle<TAppState>;
	private sequence: number;

	constructor(options: AgentHarnessOptions<TAppState>) {
		assertSingleDurableSource(options);

		this.promptSlots = [...(options.promptSlots ?? [])];
		this.sessionHandle = options.sessionHandle;
		this.sequence = options.sessionHandle?.snapshot.entries.length ?? 0;

		const durable = options.sessionHandle
			? restoreFromSnapshot(options.sessionHandle.snapshot)
			: {
					instructions: options.instructions,
					messages: options.messages,
					appState: options.appState,
				};

		this.agent = new Agent<TAppState>({
			model: options.model,
			provider: options.provider,
			tools: options.tools,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			toolExecution: options.toolExecution,
			toolMiddlewares: options.toolMiddlewares,
			session: options.session,
			...durable,
			prepareContext: (context) => this.prepareContext(context),
		});

		this.agent.subscribe((event) => this.handleCoreEvent(event));
	}

	get state(): AgentState<TAppState> {
		return this.agent.state;
	}

	get signal(): AbortSignal | undefined {
		return this.agent.signal;
	}

	getSession(): Session<TAppState> {
		return this.agent.getSession();
	}

	setAppState(next: TAppState): void {
		this.agent.setAppState(next);
	}

	updateAppState(update: (current: TAppState) => TAppState): void {
		this.agent.updateAppState(update);
	}

	/** 唯一的事件出口：core 事件与后续 harness 自身产生的事件都从这里出去。 */
	subscribe(listener: AgentEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	invoke(input: AgentInput): Promise<AgentMessage[]> {
		return this.agent.invoke(input);
	}

	/**
	 * 走门面自己的 listeners，而不是直接返回 agent.stream()：
	 * 否则 harness 自己产生的事件（Spec 16 的 compaction、Spec 17 的 skill）不会进入这条流。
	 */
	stream(input: AgentInput): AgentRun {
		const output = new EventStream<AgentEvent, AgentMessage[]>(
			() => false,
			() => [],
		);
		const unsubscribe = this.subscribe((event) => {
			output.push(event);
		});

		let run: Promise<AgentMessage[]>;
		try {
			run = this.invoke(input);
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

	steer(message: AgentMessage): void {
		this.agent.steer(message);
	}

	followUp(message: AgentMessage): void {
		this.agent.followUp(message);
	}

	abort(): void {
		this.agent.abort();
	}

	waitForIdle(): Promise<void> {
		return this.agent.waitForIdle();
	}

	/**
	 * 只透传 core 行为：清空进程内 transcript。
	 * SessionStore 是 append-only 的，磁盘上的历史不会因此消失。
	 */
	reset(): void {
		this.agent.reset();
	}

	/** 动态结果只进入本次请求，不回写 AgentState.systemPrompt。 */
	private async prepareContext(context: AgentContext): Promise<AgentContext> {
		if (this.promptSlots.length === 0) return context;

		return {
			...context,
			systemPrompt: await renderPrompt(this.promptSlots, context),
		};
	}

	/** 先落盘再对外发事件，UI 不会先显示一条最终没能写入的消息。 */
	private async handleCoreEvent(event: AgentEvent): Promise<void> {
		await this.persist(event);
		await this.emit(event);
	}

	private async persist(event: AgentEvent): Promise<void> {
		const handle = this.sessionHandle;
		if (!handle) return;

		const timestamp = new Date().toISOString();

		if (event.type === "message_end") {
			await handle.append({
				type: "message",
				id: `${handle.id}:${this.sequence++}`,
				timestamp,
				message: event.message,
			});
		}

		if (event.type === "agent_end") {
			await handle.append({
				type: "app_state",
				id: `${handle.id}:${this.sequence++}`,
				timestamp,
				value: cloneJson(this.agent.state.appState),
			});
		}
	}

	/** 保留 core 的 listener 语义：按订阅顺序 await，任一失败让整次 run 失败。 */
	private async emit(event: AgentEvent): Promise<void> {
		for (const listener of [...this.listeners]) {
			await listener(event);
		}
	}
}

/**
 * 类型已经排除了这种组合，但 JS 调用方仍可能传进来。
 * 静默采用其中一份会让恢复结果取决于实现细节，因此直接拒绝。
 */
function assertSingleDurableSource(options: AgentHarnessOptions<JsonObject>): void {
	if (!options.sessionHandle) return;

	const conflicting = (["session", "instructions", "messages", "appState"] as const).filter(
		(key) => options[key] !== undefined,
	);

	if (conflicting.length > 0) {
		throw new Error(`sessionHandle already provides durable state; remove ${conflicting.join(", ")}`);
	}
}
