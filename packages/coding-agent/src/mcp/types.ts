import type { AgentTool } from "@jai/agent";
import type { CodingToolPresentation } from "../sdk/tool-presentation";

export interface McpStdioServer {
	readonly name: string;
	readonly type: "stdio";
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly cwd?: string;
}

export interface McpHttpServer {
	readonly name: string;
	readonly type: "streamable-http";
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
}

export interface McpSseServer {
	readonly name: string;
	readonly type: "sse";
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
}

export type McpServer = McpStdioServer | McpHttpServer | McpSseServer;

export interface McpDiagnostic {
	readonly serverName: string;
	readonly message: string;
}

export interface McpRuntime {
	readonly tools: readonly McpTool[];
	readonly diagnostics: readonly McpDiagnostic[];
	close(): Promise<void>;
}

export interface McpTool {
	readonly tool: AgentTool;
	readonly presentation: CodingToolPresentation;
}

export interface McpConnectOptions {
	readonly namespace: string;
	readonly servers: readonly McpServer[];
	readonly signal?: AbortSignal;
}
