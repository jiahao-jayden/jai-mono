import type { AssistantMessage, Model } from "@jai/ai";
import { CodedError } from "@jai/common";
import type { AgentContext, AgentMessage } from "../../core/types";
import type { SessionEntry } from "../session/types";
import { safeJson } from "./serialize";
import type { CompactionSettings, CompactionSettingsOverrides, ContextTokenEstimate } from "./types";

const CHARS_PER_TOKEN = 4;
/** 图片按固定占位计价：base64 字符数与实际 token 数没有可用的换算关系。 */
const IMAGE_CHARS = 4_800;

/**
 * 字符数除以 4 的启发式估算。不是账单数据，只用来决定"是否该压缩了"，
 * 以及比较压缩前后的体积。为每个模型维护近似 tokenizer 的收益抵不上它的漂移成本。
 */
export function estimateTokens(value: AgentMessage | AgentContext): number {
	return Math.ceil(countChars(value) / CHARS_PER_TOKEN);
}

function countChars(value: AgentMessage | AgentContext): number {
	return "role" in value ? messageChars(value) : contextChars(value);
}

function contextChars(context: AgentContext): number {
	return (
		context.systemPrompt.length +
		safeJson(context.tools).length +
		context.messages.reduce((total, message) => total + messageChars(message), 0)
	);
}

function messageChars(message: AgentMessage): number {
	const envelope = message.role.length + (message.role === "toolResult" ? message.toolName.length : 0);
	if (typeof message.content === "string") return envelope + message.content.length;

	return message.content.reduce(
		(total, part) => total + (part.type === "image" ? IMAGE_CHARS : safeJson(part).length),
		envelope,
	);
}

/**
 * hybrid 口径：以 provider 报告的最后一次 usage 为基准，只估算它之后新增的消息。
 * 同时做一次全量估算并取较大值——基准无法察觉 system prompt 或 tools 在两次调用间变大。
 *
 * 传入 ledger 时还会检查基准是否已被 compaction 作废：projection 换掉了早期历史后，
 * 其中保留的 assistant usage 描述的是压缩前的那次请求。
 */
export function estimateContextTokens(context: AgentContext, entries?: readonly SessionEntry[]): ContextTokenEstimate {
	const fullEstimateTokens = estimateTokens(context);
	const lastUsageIndex = findLastUsageIndex(context.messages);
	const stale = entries !== undefined && compactedAfterLastUsage(entries);

	if (lastUsageIndex === undefined || stale) {
		return {
			tokens: fullEstimateTokens,
			usageTokens: 0,
			trailingTokens: fullEstimateTokens,
			fullEstimateTokens,
			usageBaselineValid: false,
			lastUsageIndex: null,
		};
	}

	const usageTokens = (context.messages[lastUsageIndex] as AssistantMessage).usage.totalTokens;
	const trailingTokens = context.messages
		.slice(lastUsageIndex + 1)
		.reduce((total, message) => total + estimateTokens(message), 0);

	return {
		tokens: Math.max(usageTokens + trailingTokens, fullEstimateTokens),
		usageTokens,
		trailingTokens,
		fullEstimateTokens,
		usageBaselineValid: true,
		lastUsageIndex,
	};
}

/**
 * contextOverflow 的 partial response usage 仍然有效：它恰好说明下一次调用前必须压缩。
 * error / aborted 的 usage 描述的是没有真正发生的那次请求。
 */
function hasValidUsage(message: AgentMessage): boolean {
	return (
		message.role === "assistant" &&
		message.stopReason !== "error" &&
		message.stopReason !== "aborted" &&
		message.usage.totalTokens > 0
	);
}

function findLastUsageIndex(messages: readonly AgentMessage[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (hasValidUsage(messages[index] as AgentMessage)) return index;
	}
	return undefined;
}

function compactedAfterLastUsage(entries: readonly SessionEntry[]): boolean {
	let lastUsage = -1;
	let lastCompaction = -1;

	entries.forEach((entry, index) => {
		if (entry.type === "compaction") lastCompaction = index;
		else if (entry.type === "message" && hasValidUsage(entry.message)) lastUsage = index;
	});

	return lastCompaction > lastUsage;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * 默认预留 = 模型输出上限 + 4,096，夹在 8,192 与 20,000 之间。
 * 比固定值更能同时照顾小窗口模型和大输出模型。
 */
export function resolveCompactionSettings(
	model: Model,
	overrides: CompactionSettingsOverrides = {},
): CompactionSettings {
	const reserveTokens = overrides.reserveTokens ?? clamp(model.maxTokens + 4_096, 8_192, 20_000);
	const usableContext = Math.max(0, model.contextWindow - reserveTokens);

	const settings: CompactionSettings = {
		reserveTokens,
		tailTurns: overrides.tailTurns ?? 2,
		preserveRecentTokens:
			overrides.preserveRecentTokens ??
			Math.min(usableContext, clamp(Math.floor(usableContext * 0.25), 2_000, 8_000)),
	};

	validate(settings, model);
	return settings;
}

/** 配置错误在解析时就抛，而不是等第一次调用时伪装成 provider error。 */
function validate(settings: CompactionSettings, model: Model): void {
	for (const [key, value] of Object.entries(settings)) {
		if (!Number.isFinite(value)) {
			throw new CodedError({ code: "compaction.invalid_setting", message: `compaction.${key} must be a finite number` });
		}
		if (value < 0) {
			throw new CodedError({ code: "compaction.invalid_setting", message: `compaction.${key} must not be negative` });
		}
	}
	if (!Number.isInteger(settings.tailTurns)) {
		throw new CodedError({ code: "compaction.invalid_setting", message: "compaction.tailTurns must be an integer" });
	}
	if (settings.reserveTokens >= model.contextWindow) {
		throw new CodedError({
			code: "compaction.invalid_setting",
			message: `compaction.reserveTokens (${settings.reserveTokens}) must be below the context window (${model.contextWindow})`,
		});
	}
	if (settings.preserveRecentTokens > model.contextWindow - settings.reserveTokens) {
		throw new CodedError({
			code: "compaction.invalid_setting",
			message: "compaction.preserveRecentTokens must fit in the context window left after reserveTokens",
		});
	}
}

/** 严格大于：刚好落在边界时不提前多花一次摘要调用。 */
export function shouldCompact(contextTokens: number, model: Model, settings: CompactionSettings): boolean {
	return contextTokens > model.contextWindow - settings.reserveTokens;
}
