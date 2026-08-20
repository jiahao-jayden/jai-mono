import { TaggedError } from "better-result";

export type AgentPluginLoadReason = "root_unavailable" | "invalid_manifest" | "unsupported_version" | "path_escape";

export class AgentPluginLoadFailed extends TaggedError("coding_agent_plugin.load_failed")<{
	readonly reason: AgentPluginLoadReason;
	readonly message: string;
	readonly path?: string;
	readonly cause?: unknown;
}> {}

export class AgentPluginMcpConnectionFailed extends TaggedError("coding_agent_plugin.mcp_connection_failed")<{
	readonly serverName: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}
