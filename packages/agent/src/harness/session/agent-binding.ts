import type { Agent, AgentOptions } from "../../core/agent";
import { type AgentState, cloneJson, type JsonObject } from "../../core/agent-state";
import type { SessionHandle, SessionSnapshot } from "./types";

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
		systemPrompt: state.systemPrompt,
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

/** 恢复只带回 durable 部分；运行期字段一律从 idle 默认值开始。 */
export function toAgentOptions<TAppState extends JsonObject>(
	snapshot: SessionSnapshot<TAppState>,
): Pick<AgentOptions<TAppState>, "instructions" | "messages" | "appState"> {
	return {
		instructions: snapshot.systemPrompt,
		messages: snapshot.entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
		appState: cloneJson(snapshot.appState),
	};
}

/**
 * 订阅 Agent 事件并落盘：消息在 message_end 追加，
 * 业务状态在一次 run 结束时作为 checkpoint 追加。
 */
export function attachSessionStore<TAppState extends JsonObject>(
	agent: Agent<TAppState>,
	session: SessionHandle<TAppState>,
): () => void {
	let sequence = session.snapshot.entries.length;

	return agent.subscribe(async (event) => {
		const timestamp = new Date().toISOString();

		if (event.type === "message_end") {
			await session.append({
				type: "message",
				id: `${session.id}:${sequence++}`,
				timestamp,
				message: event.message,
			});
		}

		if (event.type === "agent_end") {
			await session.append({
				type: "app_state",
				id: `${session.id}:${sequence++}`,
				timestamp,
				value: cloneJson(agent.state.appState),
			});
		}
	});
}
