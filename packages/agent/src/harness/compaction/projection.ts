import type { TextContent, UserMessage } from "@jai/ai";
import type { AgentMessage } from "../../core/types";
import type { CompactionEntry, MessageEntry, SessionEntry } from "../session/types";
import { estimateTokens } from "./estimate";
import type { CompactionSettings } from "./types";

export interface CompactionCut {
	firstKeptEntryId: string;
	messagesToSummarize: AgentMessage[];
	messagesToKeep: AgentMessage[];
}

function isMessage(entry: SessionEntry): entry is MessageEntry {
	return entry.type === "message";
}

export function latestCompaction(entries: readonly SessionEntry[]): CompactionEntry | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as SessionEntry;
		if (entry.type === "compaction") return entry;
	}
	return undefined;
}

/**
 * 把 append-only 日志读成"本次要发给 provider 的消息序列"。
 * 只有最新一条 compaction 生效：它的 summary 已经涵盖了此前所有摘要。
 */
export function projectCompactedMessages(entries: readonly SessionEntry[]): AgentMessage[] {
	const index = entries.findLastIndex((entry) => entry.type === "compaction");
	if (index < 0) return entries.filter(isMessage).map((entry) => entry.message);

	const compaction = entries[index] as CompactionEntry;
	const before = entries.slice(0, index).filter(isMessage);
	const keepFrom = before.findIndex((entry) => entry.id === compaction.firstKeptEntryId);

	return buildCompactedMessages(compaction.summary, Date.parse(compaction.timestamp), [
		...(keepFrom < 0 ? [] : before.slice(keepFrom).map((entry) => entry.message)),
		...entries
			.slice(index + 1)
			.filter(isMessage)
			.map((entry) => entry.message),
	]);
}

/**
 * summary + 保留原文，compaction 期间与后续 projection 共用同一份拼装规则。
 * 尾部本身以 user message 开头时把摘要并进去，否则会出现相邻的两个 user role，
 * 而 Anthropic 不会替我们合并它们。
 */
export function buildCompactedMessages(
	summary: string,
	timestamp: number,
	tail: readonly AgentMessage[],
): AgentMessage[] {
	const head = tail[0];
	if (head?.role === "user") return [mergeIntoUserMessage(summary, head), ...tail.slice(1)];
	return [toCompactionMessage(summary, timestamp), ...tail];
}

function summaryText(summary: string): string {
	return `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${summary}\n</summary>`;
}

function toCompactionMessage(summary: string, timestamp: number): UserMessage {
	return { role: "user", content: summaryText(summary), timestamp };
}

function mergeIntoUserMessage(summary: string, message: UserMessage): UserMessage {
	const prefix = summaryText(summary);
	return {
		...message,
		content:
			typeof message.content === "string"
				? `${prefix}\n\n${message.content}`
				: [{ type: "text", text: prefix } satisfies TextContent, ...message.content],
	};
}

/**
 * 决定这次压缩摘要哪一段、保留哪一段。返回 undefined 表示没有新增可总结的历史。
 *
 * 待总结区间从上一条 compaction 的 firstKeptEntryId 起算：旧摘要已经覆盖的更早历史
 * 不再重读，摘要调用的输入因此随"新增历史"增长，而不是随整个 session 从头增长。
 */
export function findCompactionCut(
	entries: readonly SessionEntry[],
	settings: CompactionSettings,
): CompactionCut | undefined {
	const candidates = summarizableEntries(entries);
	const messages = candidates.map((entry) => entry.message);
	const keepStart = findKeepStart(messages, settings);

	if (keepStart <= 0 || keepStart >= candidates.length) return undefined;

	return {
		firstKeptEntryId: (candidates[keepStart] as MessageEntry).id,
		messagesToSummarize: messages.slice(0, keepStart),
		messagesToKeep: messages.slice(keepStart),
	};
}

function summarizableEntries(entries: readonly SessionEntry[]): MessageEntry[] {
	const messages = entries.filter(isMessage);
	const compaction = latestCompaction(entries);
	if (!compaction) return messages;

	const start = messages.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	return start < 0 ? messages : messages.slice(start);
}

function findKeepStart(messages: readonly AgentMessage[], settings: CompactionSettings): number {
	const turnStarts = messages.flatMap((message, index) => (message.role === "user" ? [index] : []));
	const considered = turnStarts.slice(-Math.max(1, settings.tailTurns));

	let keepStart = messages.length;
	let used = 0;

	for (let index = considered.length - 1; index >= 0; index -= 1) {
		const start = considered[index] as number;
		const size = tokensBetween(messages, start, keepStart);
		if (used + size > settings.preserveRecentTokens) break;
		used += size;
		keepStart = start;
	}

	if (keepStart < messages.length) return keepStart;
	return largestSafeSuffix(messages, considered[considered.length - 1] ?? 0, settings.preserveRecentTokens);
}

/**
 * 连最新一个 turn 都放不进预算时，退到该 turn 内部能放下的最大安全后缀；
 * 一个都放不下就保留最小的安全组，宁可暂时超预算也不发出无效上下文。
 */
function largestSafeSuffix(messages: readonly AgentMessage[], floor: number, budget: number): number {
	let smallest = messages.length;

	for (let index = floor; index < messages.length; index += 1) {
		if (!isSafeBoundary(messages[index] as AgentMessage)) continue;
		if (tokensBetween(messages, index, messages.length) <= budget) return index;
		smallest = index;
	}

	return smallest;
}

/**
 * toolResult 不能当开头：声明它的 assistant message 已经被摘要掉了。
 * 其余角色都能独立起头——assistant 之前的 tool 往返被丢弃并不破坏协议。
 */
function isSafeBoundary(message: AgentMessage): boolean {
	return message.role !== "toolResult";
}

/** 以给定切点压缩后会得到的投影。用于在 append 之前比较压缩前后的体积。 */
export function projectWithCompaction(
	entries: readonly SessionEntry[],
	summary: string,
	firstKeptEntryId: string,
	timestamp: number,
): AgentMessage[] {
	const messages = entries.filter(isMessage);
	const start = messages.findIndex((entry) => entry.id === firstKeptEntryId);

	return buildCompactedMessages(
		summary,
		timestamp,
		start < 0 ? [] : messages.slice(start).map((entry) => entry.message),
	);
}

/** 校验 custom strategy 给出的切点：必须指向真实 message entry，且落在协议安全边界上。 */
export function isSafeCutPoint(entries: readonly SessionEntry[], firstKeptEntryId: string): boolean {
	const kept = entries.filter(isMessage).find((entry) => entry.id === firstKeptEntryId);
	return kept !== undefined && isSafeBoundary(kept.message);
}

function tokensBetween(messages: readonly AgentMessage[], start: number, end: number): number {
	return messages.slice(start, end).reduce((total, message) => total + estimateTokens(message), 0);
}
