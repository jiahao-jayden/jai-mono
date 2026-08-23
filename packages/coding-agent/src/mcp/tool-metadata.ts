import type { CodingToolPresentation } from "../sdk/tool-presentation";

/** The subset of MCP tool annotations that is safe and useful for transcript presentation. */
export interface McpToolMetadata {
	readonly name: string;
	readonly annotations?: {
		readonly title?: string;
		readonly readOnlyHint?: boolean;
	};
}

/**
 * An MCP tool is always presented as an external call. Its annotations stay
 * out of the presentation category because they are hints, not authorization
 * input, and a read-only call is not a local file read.
 */
export function mcpToolPresentation(tool: McpToolMetadata): CodingToolPresentation {
	return {
		activityKind: "call",
		title: () => tool.annotations?.title?.trim() || tool.name,
	};
}
