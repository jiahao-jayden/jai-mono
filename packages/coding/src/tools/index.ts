import { type AgentTool, createHarnessTools } from "@jai/agent";
import { NodeExecutionEnvironment } from "@jai/agent/node";
import type { CodingToolOptions } from "./types";

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
