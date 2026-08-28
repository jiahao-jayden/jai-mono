import type { AgentTool } from "../../core";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createReadTool } from "./read";
import type { HarnessToolsOptions } from "./types";
import { createWriteTool } from "./write";

export { type BashToolDetails, type BashToolInput, createBashTool } from "./bash";
export { createEditTool, type EditToolDetails, type EditToolInput } from "./edit";
export { createReadTool, type ReadToolDetails, type ReadToolInput } from "./read";
export type {
	BashToolOptions,
	HarnessToolsOptions,
	TruncationDetails,
	WorkspaceToolOptions,
} from "./types";
export { createWriteTool, type WriteToolDetails, type WriteToolInput } from "./write";

export function createHarnessTools(options: HarnessToolsOptions): AgentTool[] {
	const workspace = {
		fileSystem: options.environment,
		workspaceRoot: options.workspaceRoot,
	};
	return [
		createReadTool(workspace),
		createBashTool({
			...workspace,
			shell: options.environment,
			defaultTimeoutMs: options.bash?.defaultTimeoutMs,
		}),
		createEditTool(workspace),
		createWriteTool(workspace),
	];
}
