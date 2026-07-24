import type { AgentTool } from "@jai/agent";
import { createBashTool } from "./bash";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createReadTool } from "./read";
import type { BashToolOptions, CodingToolOptions } from "./types";
import { createWriteTool } from "./write";

export { type BashToolDetails, type BashToolInput, createBashTool } from "./bash";
export { createEditTool, type EditToolDetails, type EditToolInput } from "./edit";
export { createGlobTool, type GlobToolDetails, type GlobToolInput } from "./glob";
export { createGrepTool, type GrepToolDetails, type GrepToolInput } from "./grep";
export { createReadTool, type ReadToolDetails, type ReadToolInput } from "./read";
export type { BashToolOptions, CodingToolOptions, TruncationDetails } from "./types";
export { createWriteTool, type WriteToolDetails, type WriteToolInput } from "./write";

export function createCodingTools(
	options: CodingToolOptions & Pick<BashToolOptions, "shell" | "timeoutMs">,
): AgentTool[] {
	return [
		createReadTool(options),
		createGlobTool(options),
		createGrepTool(options),
		createWriteTool(options),
		createEditTool(options),
		createBashTool(options),
	];
}
