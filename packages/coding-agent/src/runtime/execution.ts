import type { AgentMessage, JsonObject, SessionHandle } from "@jai/agent";

export interface AgentExecutionInput {
	readonly prompt: string;
	readonly instructions: string;
	readonly excludeTools?: readonly string[];
	readonly signal: AbortSignal;
	readonly onActivity?: (toolName: string) => void;
	/** The SpawnAgent tool call that initiated this child. Used to derive a deterministic child session id. */
	readonly toolCallId: string;
}

export type RunAgentExecution = (input: AgentExecutionInput) => Promise<AgentMessage[]>;

/** Host-supplied factory that creates or opens a journal-only child session for a subagent. */
export type OpenChildSession<TAppState extends JsonObject = JsonObject> = (
	toolCallId: string,
) => Promise<SessionHandle<TAppState>>;
