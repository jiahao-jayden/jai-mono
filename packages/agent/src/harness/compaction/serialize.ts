import type { AssistantMessage } from "@jai/ai";
import type { AgentMessage } from "../../core/types";

/** 一个 tool result 不该独占摘要预算，超长部分对摘要没有边际价值。 */
const TOOL_RESULT_MAX_CHARS = 2_000;

/**
 * 把消息压成供模型阅读的转录文本，用纯文本 role label 而不是逐条伪 XML。
 * 消息正文可能原样包含 `</user>` 这样的片段，而这里没有 escaping——
 * 标签给不了真正的数据边界，label 至少诚实地表达"这是一份转录"。
 */
export function serializeConversation(messages: readonly AgentMessage[]): string {
	return messages.map(serializeMessage).filter(Boolean).join("\n\n");
}

/**
 * 一次摘要调用产出了什么。压缩与分支总结共用这一份判定："哪些 stopReason 能产出
 * 可用摘要"是领域约束，两处各写一遍就是第二份真相源；而两者的失败要映射成不同的
 * 错误类型，所以这里只给出结论，不自己抛。
 */
export type SummaryOutcome =
	| { status: "ok"; text: string }
	| { status: "aborted" }
	| { status: "failed"; reason: string };

export function summaryOutcomeOf(message: AssistantMessage): SummaryOutcome {
	if (message.stopReason === "aborted") return { status: "aborted" };
	if (message.stopReason !== "stop" && message.stopReason !== "length") {
		return {
			status: "failed",
			reason: `ended with stopReason "${message.stopReason}": ${message.error?.message ?? "no summary produced"}`,
		};
	}

	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();

	return text.length === 0 ? { status: "failed", reason: "returned no text" } : { status: "ok", text };
}

/** 循环引用之类的取值不该让压缩死在拼 Prompt 或估算体积这一步。 */
export function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "[unserializable]";
	}
}

function serializeMessage(message: AgentMessage): string {
	switch (message.role) {
		case "user":
			return `[User]: ${flatten(message.content)}`;
		case "assistant":
			// thinking 不进摘要输入：体积大，对"接着做什么"没有增量信息。
			return message.content
				.flatMap((part) => {
					if (part.type === "text") return part.text ? [`[Assistant]: ${part.text}`] : [];
					if (part.type === "toolCall")
						return [`[Assistant tool call]: ${part.name}(${safeJson(part.arguments)})`];
					return [];
				})
				.join("\n");
		case "toolResult":
			return `[Tool result: ${message.toolName}, error=${message.isError}]: ${truncate(flatten(message.content))}`;
	}
}

function flatten(content: AgentMessage["content"]): string {
	if (typeof content === "string") return content;

	return content
		.map((part) => {
			if (part.type === "text") return part.text;
			if (part.type === "image") return "[image]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function truncate(value: string): string {
	return value.length <= TOOL_RESULT_MAX_CHARS ? value : `${value.slice(0, TOOL_RESULT_MAX_CHARS)}\n[truncated]`;
}
