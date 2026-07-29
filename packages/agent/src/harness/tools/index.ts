import type { AgentTool } from "../../core";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createReadTool } from "./read";
import type { HarnessToolsOptions } from "./types";
import { createWriteTool } from "./write";

export { type BashToolDetails, type BashToolInput, createBashTool } from "./bash";
export { createEditTool, type EditToolDetails, type EditToolInput } from "./edit";
export { createGlobTool, type GlobToolDetails, type GlobToolInput } from "./glob";
export { createGrepTool, type GrepToolDetails, type GrepToolInput } from "./grep";
export { createReadTool, type ReadToolDetails, type ReadToolInput } from "./read";
export type {
	BashToolOptions,
	HarnessToolsOptions,
	SearchToolOptions,
	TruncationDetails,
	WorkspaceToolOptions,
} from "./types";
export { createWriteTool, type WriteToolDetails, type WriteToolInput } from "./write";

export function createHarnessTools(options: HarnessToolsOptions): AgentTool[] {
	const workspace = {
		fileSystem: options.environment,
		workspaceRoot: options.workspaceRoot,
	};
	const search = { ...workspace, fileSearch: options.environment };
	return [
		createReadTool(workspace),
		createGlobTool(search),
		createGrepTool(search),
		createWriteTool(workspace),
		createEditTool(workspace),
		createBashTool({
			...workspace,
			shell: options.environment,
			defaultTimeoutMs: options.bash?.defaultTimeoutMs,
		}),
	];
}
