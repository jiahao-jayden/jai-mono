import type { AgentMessage } from "@jai/agent";

export interface AgentExecutionInput {
	readonly prompt: string;
	readonly instructions: string;
	readonly excludeTools?: readonly string[];
	readonly signal: AbortSignal;
	readonly onActivity?: (toolName: string) => void;
}

export type RunAgentExecution = (input: AgentExecutionInput) => Promise<AgentMessage[]>;
