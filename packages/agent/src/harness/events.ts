import type { AgentEvent, AgentMessage } from "../core/types";
import type { CompactionErrorInfo, CompactionTrigger } from "./compaction/types";
import type { CompactionEntry } from "./session/types";

/**
 * harness 的事件词汇：core 的全部事件，加上只有 harness 会产生的那些。
 *
 * 没有把它们塞进 core 的 AgentEvent：直接使用 Agent 的调用方不该在 switch 里
 * 处理一批永远不会到来的事件。
 */
export type HarnessEvent =
	| AgentEvent
	| { type: "compaction_start"; trigger: CompactionTrigger; tokensBefore: number }
	| {
			type: "compaction_end";
			trigger: CompactionTrigger;
			outcome: { status: "success"; entry: CompactionEntry } | { status: "error"; error: CompactionErrorInfo };
	  };

export type HarnessEventListener = (event: HarnessEvent) => void | Promise<void>;

/** 与 AgentRun 同形，只是事件联合更宽。 */
export interface HarnessRun extends AsyncIterable<HarnessEvent> {
	result(): Promise<AgentMessage[]>;
}
