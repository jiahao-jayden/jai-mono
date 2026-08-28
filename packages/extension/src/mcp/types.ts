import type { JsonObject } from "@jai/coding-agent";

export type McpStdioServer = JsonObject & {
	readonly name: string;
	readonly type: "stdio";
	readonly command: string;
	readonly args: string[];
	readonly env: Record<string, string>;
	readonly cwd?: string;
};

export type McpHttpServer = JsonObject & {
	readonly name: string;
	readonly type: "streamable-http";
	readonly url: string;
	readonly headers: Record<string, string>;
};

export type McpSseServer = JsonObject & {
	readonly name: string;
	readonly type: "sse";
	readonly url: string;
	readonly headers: Record<string, string>;
};

export type McpServer = McpStdioServer | McpHttpServer | McpSseServer;

export type McpExtensionConfiguration = JsonObject & { readonly servers: Record<string, McpServer> };

export interface McpExtensionOptions {
	/** Stable Extension identifier; defaults to `mcp`. */
	readonly id?: string;
	/** Prefixes generated tools and prevents conflicts between multiple official MCP Extensions. */
	readonly namespace?: string;
	/** First retry delay in milliseconds. */
	readonly initialRetryDelayMs?: number;
	/** Upper bound for exponential reconnect delay in milliseconds. */
	readonly maxRetryDelayMs?: number;
}

export interface McpToolMetadata {
	readonly name: string;
	readonly annotations?: {
		readonly title?: string;
		readonly readOnlyHint?: boolean;
	};
}
