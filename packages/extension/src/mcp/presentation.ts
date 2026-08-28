import type { CodingToolPresentation } from "@jai/coding-agent";
import type { McpToolMetadata } from "./types";

export type { McpToolMetadata } from "./types";

/** MCP annotations only affect transcript presentation, never permission classification. */
export function mcpToolPresentation(tool: McpToolMetadata): CodingToolPresentation {
	return {
		activityKind: "call",
		title: () => tool.annotations?.title?.trim() || tool.name,
	};
}
