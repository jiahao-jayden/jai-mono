import type { AssistantMessage } from "@jai/ai";
import type { SessionEntry } from "../session/types";

/**
 * 只认两个确定信号：OpenAI 家族的 error code，以及 Anthropic 那条形状固定的 400。
 *
 * 不匹配 HTTP 413、无 body 的 400、或"maximum context length"之类的第三方文本长尾——
 * 把普通请求错误误判成 overflow，会白花一次摘要调用还掩盖真正的故障。
 * 保留 context_length_exceeded 的第三方 openai-compatible provider 能自然命中。
 *
 * stopReason === "contextOverflow" 不在此列：那是成功但截断的响应，走另一条路径。
 */
export function isContextOverflow(message: AssistantMessage): boolean {
	if (message.error?.code === "context_length_exceeded") return true;

	return (
		message.provider === "anthropic" &&
		message.error?.status === 400 &&
		message.error.type === "invalid_request_error" &&
		/prompt is too long/i.test(message.error.message)
	);
}

/**
 * 最近一条 assistant 是截断响应、且此后还没压缩过。
 *
 * "此后还没压缩过"这半句是必须的：截断的 partial 会留在保留尾部里，
 * 少了这个条件就会每次请求前都重压一遍。
 */
export function hasUncompactedTruncation(entries: readonly SessionEntry[]): boolean {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as SessionEntry;
		if (entry.type === "compaction") return false;
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		return entry.message.stopReason === "contextOverflow";
	}
	return false;
}
