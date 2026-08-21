import type { ToolActivityKind } from "@jai/agent";

/** The subset of MCP tool annotations that is safe and useful for transcript presentation. */
export interface McpToolMetadata {
	readonly name: string;
	readonly annotations?: {
		readonly title?: string;
		readonly readOnlyHint?: boolean;
	};
}

/**
 * MCP annotations are hints, never authorization input. Only a positive
 * read-only declaration has a presentation mapping; every other MCP tool is a
 * generic operation instead of a guessed write, command, or service action.
 */
export function mcpToolActivityKind(tool: McpToolMetadata): ToolActivityKind {
	return tool.annotations?.readOnlyHint === true ? "read" : "operation";
}

export function mcpToolTitle(tool: McpToolMetadata): string {
	return tool.annotations?.title?.trim() || tool.name;
}
