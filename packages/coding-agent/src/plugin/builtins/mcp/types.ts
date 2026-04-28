import z from "zod";

/**
 * MCP server config（Claude Code 风格隐式 type）。
 *
 * 有 `command` → stdio
 * 有 `url`     → 远程（先 Streamable HTTP，失败回退 SSE）
 *
 * @example
 * {
 *   "everything": {
 *     "command": "npx",
 *     "args": ["-y", "@modelcontextprotocol/server-everything"]
 *   },
 *   "linear": {
 *     "url": "https://mcp.linear.app/sse"
 *   }
 * }
 */
export const McpStdioServerSchema = z.object({
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	cwd: z.string().optional(),
	timeout: z.number().int().positive().optional(),
	enabled: z.boolean().optional(),
});

export const McpHttpServerSchema = z.object({
	url: z.string().url(),
	headers: z.record(z.string(), z.string()).optional(),
	timeout: z.number().int().positive().optional(),
	enabled: z.boolean().optional(),
});

export const McpServerConfigSchema = z.union([McpStdioServerSchema, McpHttpServerSchema]);
export const McpServersSchema = z.record(z.string(), McpServerConfigSchema);

export type McpStdioServerConfig = z.infer<typeof McpStdioServerSchema>;
export type McpHttpServerConfig = z.infer<typeof McpHttpServerSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export function isStdioConfig(c: McpServerConfig): c is McpStdioServerConfig {
	return "command" in c;
}

export function isHttpConfig(c: McpServerConfig): c is McpHttpServerConfig {
	return "url" in c;
}

// ── Status state machine ────────────────────────────────────
//
// 与 OpenCode 对齐：pending → ready / failed / needs_auth / needs_client_registration / disabled
export type McpServerStatus =
	| { status: "pending" }
	| { status: "ready"; toolCount: number }
	| { status: "failed"; error: string }
	| { status: "needs_auth"; authUrl?: string }
	| { status: "needs_client_registration" }
	| { status: "disabled" };

export type McpServerInfo = {
	name: string;
	transport: "stdio" | "http" | "sse";
	status: McpServerStatus;
	tools?: string[];
};

// ── Constants ───────────────────────────────────────────────
export const DEFAULT_MCP_TIMEOUT = 30_000;
export const DEFAULT_OAUTH_CALLBACK_TIMEOUT = 5 * 60 * 1000;
