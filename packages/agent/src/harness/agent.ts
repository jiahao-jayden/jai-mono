import { type AssistantMessage, EventStream, type Model, type Provider } from "@jai/ai";
import { CodedError, getErrorMessage } from "@jai/common";
import { type AgentInput, CoreAgent, type CoreAgentOptions } from "../core/agent";
import { type AgentState, cloneJson, type JsonObject } from "../core/agent-state";
import type { Session } from "../core/session";
import type { AgentContext, AgentMessage, CoreAgentEvent, ObserverErrorInfo, RetryModelCall } from "../core/types";
import { compact } from "./compaction/compact";
import { estimateContextTokens, estimateTokens, resolveCompactionSettings, shouldCompact } from "./compaction/estimate";
import { hasUncompactedTruncation, isContextOverflow } from "./compaction/overflow";
import { isSafeCutPoint, projectWithCompaction } from "./compaction/projection";
import {
	type CompactInput,
	type CompactionDecisionInput,
	type CompactionErrorInfo,
	CompactionFailure,
	type CompactionResult,
	type CompactionSettings,
	type CompactionSettingsOverrides,
	type CompactionTrigger,
} from "./compaction/types";
import type { AgentEvent, AgentEventListener, AgentRun } from "./events";
import { type AgentHookMap, type BeforeModelCallPhase, HookHost } from "./hooks";
import { restoreFromSnapshot } from "./session/agent-binding";
import { SessionLedger } from "./session/ledger";
import {
	type CompactionEntry,
	SessionBusyError,
	SessionConflictError,
	type SessionHandle,
	SessionReadOnlyError,
} from "./session/types";

export interface DefaultCompactionOptions {
	settings?: CompactionSettingsOverrides;
	/** 追加到默认摘要 Prompt 末尾的领域要求，例如"保留所有文件路径"。 */
	summaryInstructions?: string;
}

/** false 表示关闭主动压缩与 overflow 自动恢复；不用 { enabled: false } 是为了不出现"已关闭但仍带参数"。 */
export type AgentCompactionOptions = false | DefaultCompactionOptions;

/** 表面只留 hooks 一个扩展入口，执行器的 seam 不再从这里透出去。 */
type AgentCommonOptions<TAppState extends JsonObject> = Omit<
	CoreAgentOptions<TAppState>,
	| "session"
	| "instructions"
	| "messages"
	| "appState"
	| "prepareContext"
	| "onModelError"
	| "toolMiddlewares"
	| "commitEvent"
	| "onObserverError"
> & {
	compaction?: AgentCompactionOptions;
	hooks?: AgentHookMap;
	/** 观察者失败的上报口；不提供则忽略。 */
	onObserverError?: (info: ObserverErrorInfo<AgentEvent>) => void;
};

interface CompactionRuntime {
	settings: CompactionSettings;
	summaryInstructions?: string;
}

/**
 * 要么给一个已打开的 SessionHandle，由门面从它的 snapshot 恢复对话历史与 appState，
 * 要么自己传这些初值。两者同时给会出现两个事实来源，因此类型上直接禁止。
 * instructions 两种变体都接受：system prompt 是运行时产物，不从 snapshot 恢复。
 */
export type AgentOptions<TAppState extends JsonObject = JsonObject> =
	| (AgentCommonOptions<TAppState> & {
			sessionHandle: SessionHandle<TAppState>;
			instructions?: string;
			session?: never;
			messages?: never;
			appState?: never;
	  })
	| (AgentCommonOptions<TAppState> & {
			sessionHandle?: undefined;
			session?: Session<TAppState>;
			instructions?: string;
			messages?: AgentMessage[];
			appState?: TAppState;
	  });

/**
 * 默认装配：恢复 session、注入动态 Prompt、把 durable 事件写回 store。
 * 内部只持有一个 CoreAgent，执行语义（steering、abort、reducer）仍然只有那一份实现。
 */
export class Agent<TAppState extends JsonObject = JsonObject> {
	private readonly agent: CoreAgent<TAppState>;
	private readonly listeners = new Set<AgentEventListener>();
	private readonly ledger: SessionLedger<TAppState>;
	private readonly model: Model;
	private readonly provider: Provider;
	private readonly compaction?: CompactionRuntime;
	private readonly hooks: HookHost;
	private readonly onObserverError?: (info: ObserverErrorInfo<AgentEvent>) => void;
	/**
	 * 本次 model call 的完整 transcript。prepareContext → provider → onModelError
	 * 是严格嵌套的，且 Agent 不允许并发 run，所以这一格暂存是安全的。
	 */
	private rawMessages: readonly AgentMessage[] = [];

	constructor(options: AgentOptions<TAppState>) {
		assertSingleDurableSource(options);

		this.model = options.model;
		this.provider = options.provider;
		this.compaction = resolveCompaction(options.model, options.compaction);
		this.hooks = new HookHost(options.hooks);
		this.onObserverError = options.onObserverError;
		// 构造期 handler 先入队，运行期 subscribe() 的观察者排在它们后面。
		for (const listener of this.hooks.onEvent) this.listeners.add(listener);

		const restored = options.sessionHandle
			? restoreFromSnapshot(options.sessionHandle.snapshot)
			: { messages: options.messages, appState: options.appState };

		this.ledger = new SessionLedger<TAppState>(
			options.sessionHandle,
			restored.messages ?? options.session?.messages ?? [],
		);

		this.agent = new CoreAgent<TAppState>({
			model: options.model,
			provider: options.provider,
			tools: options.tools,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			toolExecution: options.toolExecution,
			toolMiddlewares: this.hooks.aroundToolCall,
			session: options.session,
			instructions: options.instructions,
			...restored,
			prepareContext: (context) => this.prepareContext(context),
			onModelError: (error, context) => this.onModelError(error, context),
			// 走 commit seam 而不是 subscribe()：持久化必须在观察者之前完成，且它失败要让 run 失败。
			commitEvent: (event) => this.handleCoreEvent(event),
		});
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

	/** 唯一的观察出口：执行器事件与本层自己产生的事件都从这里出去。 */
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
	 * 走本层自己的 listeners，而不是直接返回执行器的 stream()：
	 * 否则本层产生的事件不会进入这条流。
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
	 * 清空进程内 transcript 与压缩视图，保留 appState。
	 * SessionStore 是 append-only 的，磁盘上的历史不会因此消失；重新打开同一个 session 仍会恢复。
	 */
	reset(): void {
		this.agent.reset();
		this.ledger.clear();
	}

	/**
	 * 组装本次请求的 context，顺序是固定的：
	 * 先套用既有压缩投影，再交给 beforeModelCall hooks，最后才判断要不要新压一次。
	 *
	 * 阈值必须按 hook 之后的消息算：外层裁剪掉的旧工具输出如果已经让上下文回到安全区，
	 * 就不该再花一次摘要调用。
	 */
	private async prepareContext(context: AgentContext): Promise<AgentContext> {
		this.rawMessages = context.messages;
		const projected = await this.projectContext(context, "initial");

		const compaction = this.compaction;
		if (!compaction) return projected;

		const input: CompactionDecisionInput = {
			context: projected,
			entries: this.ledger.log,
			model: this.model,
			settings: compaction.settings,
		};

		// 上一次响应被截断时无条件压一次：provider 已经说过这个 context 装不下了，
		// 这条路径不经过 shouldCompact hooks，外层取消不了。
		const due = hasUncompactedTruncation(this.ledger.log) || (await this.decideCompaction(input));
		if (!due) return projected;

		const compacted = await this.runCompaction("threshold", input);
		// 压缩改变了消息序列，上一遍 hook 的产出对不上新下标，只能重跑。
		return compacted ? await this.projectContext(context, "after_compaction") : projected;
	}

	/**
	 * provider 拒绝请求时的恢复：外层 hook 优先，都不接手才用默认的压缩重试。
	 * 压缩后确实变小、且降到阈值以下，才消耗那唯一一次重试。
	 */
	private async onModelError(error: AssistantMessage, context: AgentContext): Promise<RetryModelCall | undefined> {
		const recovery = await this.hooks.runModelError(error, context.messages, this.agent.signal);
		if (recovery) return { type: "retry", context: { ...context, messages: recovery.messages } };

		const compaction = this.compaction;
		if (!compaction || !isContextOverflow(error)) return undefined;

		// 收到的 context 是第一次请求实际使用的版本，可能已含旧投影与 beforeModelCall 的裁剪，
		// 因此前后都用全量估算，比较的才是同一把尺子。
		const before = estimateTokens(context);
		const entry = await this.runCompaction("overflow", {
			context,
			entries: this.ledger.log,
			model: this.model,
			settings: compaction.settings,
		});
		if (!entry) return undefined;

		const compacted = await this.projectContext(context, "overflow_retry");
		const after = estimateTokens(compacted);

		if (after >= before || shouldCompact(after, this.model, compaction.settings)) return undefined;
		return { type: "retry", context: compacted };
	}

	/**
	 * 投影必须从完整 transcript 出发：手上的 context 可能已经是上一次投影的结果，
	 * 而 compaction 的切点是相对完整历史的位置。
	 */
	private async projectContext(context: AgentContext, phase: BeforeModelCallPhase): Promise<AgentContext> {
		const projected = this.ledger.project(this.rawMessages);
		return { ...context, messages: await this.hooks.runBeforeModelCall(phase, projected, this.agent.signal) };
	}

	/** 默认算法先给结论，hooks 再在它上面依次修改。 */
	private decideCompaction(input: CompactionDecisionInput): Promise<boolean> {
		const decision = shouldCompact(
			estimateContextTokens(input.context, input.entries).tokens,
			input.model,
			input.settings,
		);
		return this.hooks.runShouldCompact(input, decision, this.agent.signal);
	}

	/**
	 * 一次压缩的完整生命周期。hook 只回答"压成什么"，事件、entry id、append 与失败归类留在这里。
	 * entry 先落盘再发 success，监听器看到成功时 store 已经包含结果。
	 */
	private async runCompaction(
		trigger: CompactionTrigger,
		input: CompactionDecisionInput,
	): Promise<CompactionEntry | undefined> {
		const compaction = this.compaction;
		if (!compaction) return undefined;

		await this.publish({ type: "compaction_start", trigger, tokensBefore: estimateTokens(input.context) });

		try {
			// 摘要的事实来源始终是原始 entries：beforeModelCall 的临时裁剪不能让摘要模型看不到原文。
			const compactInput: CompactInput = {
				...input,
				provider: this.provider,
				trigger,
				previous: this.ledger.latestCompaction,
				summaryInstructions: compaction.summaryInstructions,
				signal: this.agent.signal,
			};
			const result = await this.hooks.runAroundCompact(compactInput, () => compact(compactInput));

			const entry = await this.ledger.appendCompaction(this.verify(result, input));
			await this.publish({ type: "compaction_end", trigger, outcome: { status: "success", entry } });
			return entry;
		} catch (error) {
			await this.publish({
				type: "compaction_end",
				trigger,
				outcome: { status: "error", error: toErrorInfo(error) },
			});
			// 摘要失败只是放弃这次压缩；durable 写入失败必须让 run 失败，否则会静默丢历史。
			if (isSessionError(error)) throw error;
			return undefined;
		}
	}

	/** 不信任 strategy 报的 token 数：按真实投影重算，顺便挡住会产出无效上下文的切点。 */
	private verify(result: CompactionResult, input: CompactionDecisionInput): NewCompactionEntry {
		const summary = result.summary.trim();
		if (summary.length === 0) throw new CompactionFailure("unknown", "Compaction strategy returned an empty summary");
		if (!isSafeCutPoint(input.entries, result.firstKeptEntryId)) {
			throw new CompactionFailure(
				"unknown",
				`Compaction strategy returned an unusable cut point "${result.firstKeptEntryId}"`,
			);
		}

		const messages = projectWithCompaction(input.entries, summary, result.firstKeptEntryId, Date.now());

		return {
			summary,
			firstKeptEntryId: result.firstKeptEntryId,
			tokensBefore: estimateTokens(input.context),
			tokensAfter: estimateTokens({ ...input.context, messages }),
			usage: result.usage,
		};
	}

	/** 先落盘再对外发事件，UI 不会先显示一条最终没能写入的消息。 */
	private async handleCoreEvent(event: CoreAgentEvent): Promise<void> {
		await this.persist(event);
		await this.publish(event);
	}

	/** 关键写入：抛出即让整次 run 失败，对应的事件也不会对外发布。 */
	private async persist(event: CoreAgentEvent): Promise<void> {
		if (event.type === "message_end") await this.ledger.appendMessage(event.message);
		if (event.type === "agent_end") await this.ledger.appendAppState(cloneJson(this.agent.state.appState));
	}

	/**
	 * 观察分发：按注册顺序串行，但逐个隔离。
	 * 一个监听器出错不会中断 run，也不会挡住后面的监听器。
	 */
	private async publish(event: AgentEvent): Promise<void> {
		for (const listener of [...this.listeners]) {
			try {
				await listener(event);
			} catch (error) {
				this.reportObserverError(error, event);
			}
		}
	}

	private reportObserverError(error: unknown, event: AgentEvent): void {
		try {
			this.onObserverError?.({ error, event });
		} catch {
			// 上报本身失败没有更上层可以处理，只能停在这里，不能反过来影响 run。
		}
	}
}

/** id 与 timestamp 由 ledger 补，策略不参与。 */
type NewCompactionEntry = Omit<CompactionEntry, "type" | "id" | "timestamp">;

function resolveCompaction(model: Model, options: AgentCompactionOptions | undefined): CompactionRuntime | undefined {
	if (options === false) return undefined;

	return {
		settings: resolveCompactionSettings(model, options?.settings),
		summaryInstructions: options?.summaryInstructions,
	};
}

/** provider SDK 的异常先经过 ProviderErrorInfo，再在这里归到一个稳定 code 上。 */
function toErrorInfo(error: unknown): CompactionErrorInfo {
	if (error instanceof CompactionFailure) return { code: error.reason, message: error.message };
	return { code: "unknown", message: getErrorMessage(error) };
}

function isSessionError(error: unknown): boolean {
	return (
		error instanceof SessionConflictError ||
		error instanceof SessionBusyError ||
		error instanceof SessionReadOnlyError
	);
}

/**
 * 类型已经排除了这种组合，但 JS 调用方仍可能传进来。
 * 静默采用其中一份会让恢复结果取决于实现细节，因此直接拒绝。
 */
function assertSingleDurableSource(options: AgentOptions<JsonObject>): void {
	if (!options.sessionHandle) return;

	const conflicting = (["session", "messages", "appState"] as const).filter(
		(key) => options[key] !== undefined,
	);

	if (conflicting.length > 0) {
		throw new CodedError({
			code: "agent.conflicting_durable_source",
			message: `sessionHandle already provides durable state; remove ${conflicting.join(", ")}`,
		});
	}
}
