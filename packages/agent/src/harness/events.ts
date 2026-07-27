import type { AgentEvent, AgentMessage, CustomEvent } from "../core/types";
import type { CompactionErrorInfo, CompactionTrigger } from "./compaction/types";
import type { CompactionEntry } from "./session/types";

export type CompactionOutcome =
	| { status: "success"; entry: CompactionEntry }
	| { status: "error"; error: CompactionErrorInfo };

/**
 * 压缩事件走 core 的 custom 外壳：core 不必认识 CompactionEntry，
 * 也就不会为了声明这两条事件反过来依赖 harness。
 */
export type CompactionEvent =
	| CustomEvent<"compaction_start", { trigger: CompactionTrigger; tokensBefore: number }>
	| CustomEvent<"compaction_end", { trigger: CompactionTrigger; outcome: CompactionOutcome }>;

/** harness 的事件词汇：core 的全部事件，加上只有 harness 会产生的那些。 */
export type HarnessEvent = AgentEvent | CompactionEvent;

export type HarnessEventListener = (event: HarnessEvent) => void | Promise<void>;

/** 与 AgentRun 同形，只是事件联合更宽。 */
export interface HarnessRun extends AsyncIterable<HarnessEvent> {
	result(): Promise<AgentMessage[]>;
}
