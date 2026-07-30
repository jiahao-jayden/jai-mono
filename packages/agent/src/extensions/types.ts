import type { AgentTool } from "../core/types";
import type { Agent } from "../harness/agent";

/** 可组合的 Agent 行为扩展；产品级 Plugin 属于 @jai/coding。 */
export interface AgentExtension {
	readonly name: string;
	readonly tools?: readonly AgentTool[];
	initialize(agent: Agent): void | Promise<void>;
}
