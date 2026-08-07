import type { AssistantMessage } from "@jai/ai";
import type { AgentMessage, AgentToolResult, ToolCallContext, ToolMiddleware } from "../core/types";
import type { CompactInput, CompactionDecisionInput, CompactionResult } from "./compaction/types";
import type { AgentEventListener } from "./events";

/**
 * 同一次 model call 里 beforeModelCall 可能跑不止一次：压缩会重排消息序列，
 */
export type BeforeModelCallPhase = "initial" | "after_compaction" | "overflow_retry";

export interface BeforeModelCallInput {
	phase: BeforeModelCallPhase;
	/** 已套用既有压缩投影的消息副本；改动只影响本次 provider 请求。 */
	messages: AgentMessage[];
	signal?: AbortSignal;
}

export interface BeforeModelCallResult {
	messages: AgentMessage[];
}

/**
 * 只处理 messages，不开放 system prompt 与 tools：
 * 塞进一个 core 没有 execute() 的 tool schema，模型调用它时必然失败。
 *
 * 因为可能重复执行，它必须是纯函数：同样输入给同样输出，不带副作用。
 */
export type BeforeModelCallHook = (
	input: BeforeModelCallInput,
) => BeforeModelCallResult | undefined | Promise<BeforeModelCallResult | undefined>;

export interface ShouldCompactHookInput extends CompactionDecisionInput {
	/** 默认算法或上一位 handler 给出的当前判断。 */
	decision: boolean;
	signal?: AbortSignal;
}

export type ShouldCompactHook = (input: ShouldCompactHookInput) => boolean | undefined | Promise<boolean | undefined>;

export type CompactNext = () => Promise<CompactionResult>;

/** 洋葱式：可以换模型、可以在默认实现失败后兜底，也可以不调 next() 完整接管。 */
export type CompactMiddleware = (input: CompactInput, next: CompactNext) => Promise<CompactionResult>;

export interface ModelErrorHookInput {
	error: AssistantMessage;
	/** 刚才发给 provider 的最终消息，已经过 beforeModelCall。 */
	messages: readonly AgentMessage[];
	signal?: AbortSignal;
}

export interface ModelErrorRecovery {
	type: "retry";
	/** 可直接重试的 provider-ready 消息：harness 不会再跑一遍 beforeModelCall。 */
	messages: AgentMessage[];
}

export type ModelErrorHook = (
	input: ModelErrorHookInput,
) => ModelErrorRecovery | undefined | Promise<ModelErrorRecovery | undefined>;

/**
 * 门面的唯一扩展入口。字段按执行顺序排列：
 *
 * ```text
 * beforeModelCall ─► shouldCompact ─► aroundCompact ─► beforeModelCall(重跑) ─► 模型请求
 *                                                                                 │
 *                                                        ┌────────────────────────┴───────────┐
 *                                                   onModelError                        aroundToolCall
 *          onEvent 全程旁观
 * ```
 *
 * 前缀就是组合规则：`before*` 是顺序变换链，`around*` 是洋葱 middleware，
 * `on*` 是观察或首个胜出。每类都是数组，按声明顺序串行执行。
 */
export interface AgentHookMap {
	/** 每次构造 provider messages 时运行，例如裁剪旧工具输出。 */
	beforeModelCall?: readonly BeforeModelCallHook[];
	/** 修改默认的"要不要压"判断。 */
	shouldCompact?: readonly ShouldCompactHook[];
	/** 包裹或替换摘要生成。 */
	aroundCompact?: readonly CompactMiddleware[];
	/** provider 开始输出前失败时的恢复机会。 */
	onModelError?: readonly ModelErrorHook[];
	/** 包裹工具执行：权限、参数改写、结果包装、重试。 */
	aroundToolCall?: readonly ToolMiddleware[];
	/** 构造期注册的事件监听器，与 subscribe() 同一条队列、同样被隔离。 */
	onEvent?: readonly AgentEventListener[];
}

/**
 * Hook 的组合规则实现。只负责顺序、传值与短路；
 * token 估算、overflow 判定、session 写入、compaction 校验都不在这里。
 */
export class HookHost {
	private readonly beforeModelCall: BeforeModelCallHook[];
	private readonly shouldCompact: ShouldCompactHook[];
	private readonly aroundCompact: CompactMiddleware[];
	private readonly onModelError: ModelErrorHook[];
	readonly aroundToolCall: ToolMiddleware[];
	readonly onEvent: AgentEventListener[];

	// 字段与 AgentHookMap 的键一一同名；构造时拷贝，运行中改动外部数组不会让
	// 同一次 run 的 hook 链中途变形。
	constructor(hooks: AgentHookMap | undefined) {
		this.beforeModelCall = [...(hooks?.beforeModelCall ?? [])];
		this.shouldCompact = [...(hooks?.shouldCompact ?? [])];
		this.aroundCompact = [...(hooks?.aroundCompact ?? [])];
		this.onModelError = [...(hooks?.onModelError ?? [])];
		this.aroundToolCall = [...(hooks?.aroundToolCall ?? [])];
		this.onEvent = [...(hooks?.onEvent ?? [])];
	}

	/**
	 * transform chain：后一位 handler 看到前一位的产出。
	 *
	 * 每位 handler 拿到的都是深拷贝，因此就算它原地改输入，也污染不到
	 * Agent 的 transcript 和后续 handler——只有显式返回值才进入链条。
	 */
	async runBeforeModelCall(
		phase: BeforeModelCallPhase,
		messages: AgentMessage[],
		signal?: AbortSignal,
	): Promise<AgentMessage[]> {
		let current = messages;

		for (const hook of this.beforeModelCall) {
			const result = await hook({ phase, messages: structuredClone(current), signal });
			if (result) current = result.messages;
		}

		return current;
	}

	/** 从默认判断出发，每位 handler 都看到当前 decision；返回 undefined 表示不改。 */
	async runShouldCompact(input: CompactionDecisionInput, decision: boolean, signal?: AbortSignal): Promise<boolean> {
		let current = decision;

		for (const hook of this.shouldCompact) {
			const next = await hook({ ...input, decision: current, signal });
			if (next !== undefined) current = next;
		}

		return current;
	}

	/** 洋葱：不调 next() 即完整接管默认实现。 */
	runAroundCompact(input: CompactInput, base: CompactNext): Promise<CompactionResult> {
		const dispatch = (index: number): Promise<CompactionResult> => {
			const middleware = this.aroundCompact[index];
			if (!middleware) return base();

			return middleware(input, () => dispatch(index + 1));
		};

		return dispatch(0);
	}

	/** 保持单个稳定 middleware seam，使 Agent 在构造期装配的 middleware 共享一条执行链。 */
	runAroundToolCall(ctx: ToolCallContext, base: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
		const dispatch = (index: number): Promise<AgentToolResult> => {
			const middleware = this.aroundToolCall[index];
			return middleware ? middleware(ctx, () => dispatch(index + 1)) : base();
		};
		return dispatch(0);
	}

	/** 第一个给出 recovery 的 handler 胜出，其余不再执行。 */
	async runModelError(
		error: AssistantMessage,
		messages: readonly AgentMessage[],
		signal?: AbortSignal,
	): Promise<ModelErrorRecovery | undefined> {
		for (const hook of this.onModelError) {
			const recovery = await hook({ error, messages, signal });
			if (recovery) return recovery;
		}

		return undefined;
	}
}
