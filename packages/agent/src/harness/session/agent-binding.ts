import type { CoreAgentOptions } from "../../core/agent";
import { type AgentState, cloneJson, type JsonObject } from "../../core/agent-state";
import type { SessionSnapshot } from "./types";

/**
 * entry id 由 sessionId + 序号确定，不用 randomUUID：
 * 同一份 state 投影两次必须得到完全相同的 entries，否则去重与增量同步都会失效。
 */
export function toSnapshot<TAppState extends JsonObject>(
	sessionId: string,
	state: AgentState<TAppState>,
	now: string,
): SessionSnapshot<TAppState> {
	return {
		entries: state.messages.map((message, index) => ({
			type: "message",
			id: `${sessionId}:${index}`,
			timestamp: now,
			message,
		})),
		appState: cloneJson(state.appState),
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * 恢复只带回 durable 部分；运行期字段一律从 idle 默认值开始。
 * 装配执行器是门面的职责，这个投影因此不进公开入口。
 */
export function restoreFromSnapshot<TAppState extends JsonObject>(
	snapshot: SessionSnapshot<TAppState>,
): Pick<CoreAgentOptions<TAppState>, "messages" | "appState"> {
	return {
		messages: snapshot.entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
		appState: cloneJson(snapshot.appState),
	};
}
