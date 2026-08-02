import type { Model, Provider, Usage } from "@jai/ai";
import { TaggedError } from "better-result";
import type { AgentContext } from "../../core/types";
import type { CompactionEntry, SessionEntry } from "../session/types";

export interface CompactionSettings {
	/** 触发阈值之上留给模型输出与摘要调用的安全区 */
	reserveTokens: number;
	/** 最多考虑保留几个最近 user turn 的原文 */
	tailTurns: number;
	/** 保留原文尾部的 token 预算 */
	preserveRecentTokens: number;
}

export interface CompactionSettingsOverrides {
	reserveTokens?: number;
	tailTurns?: number;
	preserveRecentTokens?: number;
}

export interface ContextTokenEstimate {
	/** 本次判断使用的值：provider 基准与全量估算的较大者 */
	tokens: number;
	usageTokens: number;
	trailingTokens: number;
	fullEstimateTokens: number;
	usageBaselineValid: boolean;
	lastUsageIndex: number | null;
}

/** threshold：主动到阈值；overflow：provider 已经拒绝了请求。 */
export type CompactionTrigger = "threshold" | "overflow";

export interface CompactionDecisionInput {
	/** 已完成 Prompt 组装与既有 projection 的本次请求 context */
	context: AgentContext;
	entries: readonly SessionEntry[];
	model: Model;
	settings: CompactionSettings;
}

export interface CompactInput extends CompactionDecisionInput {
	provider: Provider;
	trigger: CompactionTrigger;
	previous?: CompactionEntry;
	summaryInstructions?: string;
	signal?: AbortSignal;
}

export interface CompactionResult {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	tokensAfter: number;
	usage: Usage;
}

export type CompactionErrorCode = "aborted" | "nothing_to_compact" | "summarization_failed" | "unknown";

/** 事件里只出现这个稳定形状，provider SDK 的异常不外泄。 */
export interface CompactionErrorInfo {
	code: CompactionErrorCode;
	message: string;
}

/** 内部载体：让策略把稳定 code 传给门面，不必让门面猜测异常类型。 */
type CompactionFailureInit = { readonly cause?: unknown; readonly message: string };
class CompactionAborted extends TaggedError("compaction.aborted")<CompactionFailureInit> {}
class NothingToCompact extends TaggedError("compaction.nothing_to_compact")<CompactionFailureInit> {}
class SummarizationFailed extends TaggedError("compaction.summarization_failed")<CompactionFailureInit> {}
class UnknownCompactionFailure extends TaggedError("compaction.unknown")<CompactionFailureInit> {}

export function compactionFailure(reason: CompactionErrorCode, message: string, options: { cause?: unknown } = {}) {
	const init = { message, ...options };
	switch (reason) {
		case "aborted":
			return new CompactionAborted(init);
		case "nothing_to_compact":
			return new NothingToCompact(init);
		case "summarization_failed":
			return new SummarizationFailed(init);
		case "unknown":
			return new UnknownCompactionFailure(init);
	}
}

export function isCompactionFailure(error: unknown): error is ReturnType<typeof compactionFailure> {
	return (
		TaggedError.is(error) &&
		(error._tag === "compaction.aborted" ||
			error._tag === "compaction.nothing_to_compact" ||
			error._tag === "compaction.summarization_failed" ||
			error._tag === "compaction.unknown")
	);
}
