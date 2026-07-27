import type { AssistantMessage } from "@jai/ai";
import type { AgentMessage } from "../../core/types";
import { estimateTokens } from "./estimate";
import { buildCompactedMessages, findCompactionCut } from "./projection";
import { serializeConversation } from "./serialize";
import { type CompactInput, CompactionFailure, type CompactionResult } from "./types";

/**
 * 默认摘要 Prompt 只规定领域无关目标。coding-agent 的身份、文件系统规则、
 * Git 工作流与 AGENTS.md 都不在这里——那属于产品层，通过 summaryInstructions 补。
 */
const SUMMARY_SYSTEM_PROMPT = [
	"You compact conversation transcripts so that another assistant can continue the work",
	"without access to the original messages. Write a dense, factual summary. Never invent",
	"details, never address the user, and never wrap the summary in commentary.",
].join(" ");

/**
 * 摘要要覆盖的内容。刻意只规定目标、不规定 Markdown 章节结构：
 * 固定模板属于产品层，coding-agent 可以用 summaryInstructions 加。
 */
const SUMMARY_CONTRACT = [
	"Summarize the conversation above into a single self-contained summary covering:",
	"- the current task and what the user is trying to achieve",
	"- constraints and preferences the user has confirmed",
	"- work already completed and the key decisions behind it",
	"- the current state, including anything left broken or unverified",
	"- open questions and the immediate next steps",
	"- exact names, identifiers, values and error text needed to continue",
].join("\n");

const FOLD_PREVIOUS_SUMMARY =
	"The previous summary covers everything before the conversation above. Fold it into one complete summary; do not refer back to it.";

export async function compact(input: CompactInput): Promise<CompactionResult> {
	const cut = findCompactionCut(input.entries, input.settings);
	if (!cut) throw new CompactionFailure("nothing_to_compact", "No new history to summarize");

	const stream = input.provider.stream(
		input.model,
		{
			systemPrompt: SUMMARY_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: buildSummaryPrompt({
						messages: cut.messagesToSummarize,
						previous: input.previous?.summary,
						instructions: input.summaryInstructions,
					}),
					timestamp: Date.now(),
				},
			],
			tools: [],
		},
		{
			maxTokens: Math.min(input.model.maxTokens, Math.floor(input.settings.reserveTokens * 0.8)),
			signal: input.signal,
		},
	);

	const response = await stream.result();
	const summary = extractSummary(response);
	const projected = {
		...input.context,
		messages: buildCompactedMessages(summary, Date.now(), cut.messagesToKeep),
	};

	return {
		summary,
		firstKeptEntryId: cut.firstKeptEntryId,
		tokensBefore: estimateTokens(input.context),
		tokensAfter: estimateTokens(projected),
		usage: response.usage,
	};
}

function extractSummary(message: AssistantMessage): string {
	if (message.stopReason === "aborted") {
		throw new CompactionFailure("aborted", "Summarization was aborted");
	}
	if (message.stopReason !== "stop" && message.stopReason !== "length") {
		throw new CompactionFailure(
			"summarization_failed",
			`Summarization ended with stopReason "${message.stopReason}": ${message.error?.message ?? "no summary produced"}`,
		);
	}

	const summary = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();

	if (summary.length === 0) throw new CompactionFailure("summarization_failed", "Summarization returned no text");
	return summary;
}

/**
 * 摘要 Prompt 是内部固定模板：顺序永远固定，也不对外公开。
 * 想补一句走 summaryInstructions，想整段接管走 hooks.aroundCompact。
 *
 * 重复压缩时输入是"上一条摘要 + 新增原文"，而不是串联所有摘要或整份 session：
 * 摘要调用的成本因此随新增历史增长，不随会话总长度增长。
 */
function buildSummaryPrompt(input: {
	messages: readonly AgentMessage[];
	previous?: string;
	instructions?: string;
}): string {
	return [
		`<conversation>\n${serializeConversation(input.messages)}\n</conversation>`,
		input.previous ? `<previous-summary>\n${input.previous}\n</previous-summary>` : undefined,
		SUMMARY_CONTRACT,
		input.previous ? FOLD_PREVIOUS_SUMMARY : undefined,
		input.instructions ? `Additional focus:\n${input.instructions}` : undefined,
	]
		.filter((section) => section !== undefined)
		.join("\n\n");
}
