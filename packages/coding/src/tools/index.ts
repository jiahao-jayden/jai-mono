import { type AgentTool, createHarnessTools } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node";
import type { CodingToolOptions } from "./types";

export {
	createSpawnAgentTool,
	MAX_CONCURRENT_SUBAGENTS,
	SPAWN_AGENT_TOOL_NAME,
	type SpawnAgentRunInput,
	type SpawnAgentRunner,
	type SpawnAgentToolDetails,
} from "./spawn-agent";
export type { CodingToolOptions } from "./types";
export {
	createUpdateTodosTool,
	type ReplaceSessionTodos,
	type SessionTodoItem,
	type SessionTodos,
	type TodoStatus,
	UPDATE_TODOS_TOOL_NAME,
	type UpdateTodosToolDetails,
} from "./update-todos";

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
