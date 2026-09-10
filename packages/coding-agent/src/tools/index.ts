import { type AgentTool, createHarnessTools } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node/environment";
import type { CodingToolName } from "./names";
import type { CodingToolOptions } from "./types";

export type { CodingToolOptions } from "./types";

export function createCodingTools(
	options: CodingToolOptions,
	environment = new NodeExecutionEnvironment({
		cwd: options.cwd,
		shellPath: options.shell,
	}),
	enabledTools?: ReadonlySet<CodingToolName>,
): AgentTool[] {
	const tools = createHarnessTools({
		environment,
		workspaceRoot: options.cwd,
		bash: { defaultTimeoutMs: options.timeoutMs },
	});
	return enabledTools ? tools.filter((tool) => enabledTools.has(tool.name as CodingToolName)) : tools;
}
