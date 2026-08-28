import { TaggedError } from "better-result";

export class McpExtensionConnectionFailed extends TaggedError("mcp_extension.connection_failed")<{
	readonly serverName: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class McpExtensionToolCallFailed extends TaggedError("mcp_extension.tool_call_failed")<{
	readonly serverName: string;
	readonly toolName: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}
