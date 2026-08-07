import { TaggedError } from "better-result";

export class McpConnectionFailed extends TaggedError("coding_mcp.connection_failed")<{
	readonly serverName: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}
