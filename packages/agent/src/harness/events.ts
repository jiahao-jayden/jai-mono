import type { AgentMessage, CoreAgentEvent, EventRun } from "../core/types";
import type { CompactionErrorInfo, CompactionTrigger } from "./compaction/types";
import type { CompactionEntry } from "./session/types";

export type CompactionOutcome =
	| { status: "success"; entry: CompactionEntry }
	| { status: "error"; error: CompactionErrorInfo };

export type CompactionEvent =
	| { type: "compaction_start"; trigger: CompactionTrigger; tokensBefore: number }
	| { type: "compaction_end"; trigger: CompactionTrigger; outcome: CompactionOutcome };

/**
 * 默认层的完整事件联合，保持扁平：无论来自执行器还是门面自身，
 * 都用同一种 `event.type` 收窄，与 core 事件一样要求 wire-safe。
 */
export type AgentEvent =
	| Exclude<CoreAgentEvent, { type: "message_end" }>
	| { type: "message_end"; message: AgentMessage; entryId?: string }
	| CompactionEvent;

/** 观察者：读事件，不影响 run。抛错会被隔离并交给 onObserverError。 */
export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;

export type AgentRun = EventRun<AgentEvent, AgentMessage[]>;
