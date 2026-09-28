import type { AgentMessage, JsonObject, SessionHandle } from "@jai/agent";

export interface AgentExecutionInput {
	readonly prompt: string;
	readonly instructions: string;
	readonly excludeTools?: readonly string[];
	readonly signal: AbortSignal;
	readonly onActivity?: (toolName: string) => void;
	/** The SpawnAgent tool call that initiated this child. Used to derive a deterministic child session id. */
	readonly toolCallId: string;
	/**
	 * Detached children survive their owning tool call and keep running in the
	 * background. They stay bound to the parent run: a parent abort still cancels them.
	 */
	readonly detached?: boolean;
	/** Model-visible background handle. Required when `detached` is true. */
	readonly agentId?: string;
	/** User-visible background title. Required when `detached` is true. */
	readonly title?: string;
}

export type RunAgentExecution = (input: AgentExecutionInput) => Promise<AgentMessage[]>;

/** Host-supplied factory that creates or opens a journal-only child session for a subagent. */
export type OpenChildSession<TAppState extends JsonObject = JsonObject> = (
	toolCallId: string,
) => Promise<SessionHandle<TAppState>>;
