import { type AgentTool, createHarnessTools } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node";
import type { CodingToolOptions } from "./types";

export { createReportProgressTool, REPORT_PROGRESS_TOOL_NAME } from "./report-progress";
export {
	createSpawnAgentTool,
	MAX_CONCURRENT_SUBAGENTS,
	SPAWN_AGENT_TOOL_NAME,
	type SpawnAgentRunInput,
	type SpawnAgentRunner,
	type SpawnAgentToolDetails,
} from "./spawn-agent";
export type { CodingToolOptions } from "./types";

export function createCodingTools(
	options: CodingToolOptions,
	environment = new NodeExecutionEnvironment({
		cwd: options.cwd,
		shellPath: options.shell,
		ripgrepPath: options.ripgrepPath,
	}),
): AgentTool[] {
	return createHarnessTools({
		environment,
		workspaceRoot: options.cwd,
		bash: { defaultTimeoutMs: options.timeoutMs },
	});
}
