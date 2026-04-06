import type { AgentTool } from "@jayden/jai-agent";
import { bashTool } from "./bash.js";
import { fileEditTool } from "./file-edit.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";

export function createDefaultTools(cwd: string): AgentTool[] {
	return [fileReadTool, fileWriteTool, fileEditTool, globTool(cwd), grepTool, bashTool(cwd)];
}
