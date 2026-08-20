import type { AgentTool } from "@jai/agent";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";

export const AGENT_PLUGINS_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" as const;

export interface AgentPluginStdioServer {
	readonly name: string;
	readonly type: "stdio";
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd?: string;
}

export interface AgentPluginHttpServer {
	readonly name: string;
	readonly type: "streamable-http";
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
}

export interface AgentPluginSseServer {
	readonly name: string;
	readonly type: "sse";
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
}

export type AgentPluginMcpServer = AgentPluginStdioServer | AgentPluginHttpServer | AgentPluginSseServer;

export interface AgentPluginMcpRuntime {
	readonly tools: readonly AgentTool[];
	readonly diagnostics: readonly AgentPluginDiagnostic[];
	close(): Promise<void>;
}
