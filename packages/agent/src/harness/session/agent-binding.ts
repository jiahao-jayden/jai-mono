import type { CoreAgentOptions } from "../../core/agent";
import { cloneJson, type JsonObject } from "../../core/agent-state";
import { branchOf, contextMessages } from "./tree";
import type { SessionSnapshot } from "./types";

/**
 * 恢复只带回 durable 部分；运行期字段一律从 idle 默认值开始。
 * 装配执行器是门面的职责，这个投影因此不进公开入口。
 */
export function restoreFromSnapshot<TAppState extends JsonObject>(
	snapshot: SessionSnapshot<TAppState>,
): Pick<CoreAgentOptions<TAppState>, "messages" | "appState"> {
	return {
		messages: contextMessages(branchOf(snapshot.entries, snapshot.leafId)),
		appState: cloneJson(snapshot.appState),
	};
}
