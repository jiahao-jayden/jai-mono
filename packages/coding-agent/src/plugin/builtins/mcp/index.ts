import path from "node:path";
import type { PluginAPI } from "../../types.js";
import type { BuiltinPluginContext, BuiltinPluginDef } from "../types.js";
import { McpManager } from "./manager.js";
import type { McpServerConfig } from "./types.js";

export { McpManager } from "./manager.js";
export { buildMcpToolName, mcpToolToAgentTool, parseMcpToolName } from "./tool-adapter.js";
export type {
	McpHttpServerConfig,
	McpServerConfig,
	McpServerInfo,
	McpServerStatus,
	McpStdioServerConfig,
} from "./types.js";
export { isHttpConfig, isStdioConfig, McpServerConfigSchema, McpServersSchema } from "./types.js";

// 把 manager 挂在 ctx 实例上，避免污染 BuiltinPluginContext 接口。
// WeakMap 让 ctx 失活时 manager 也能被 GC。
const managerByCtx = new WeakMap<BuiltinPluginContext, McpManager>();

/**
 * 从 builtin context 拿 mcpServers 配置，并启动所有 server。
 * Manager 实例与 ctx 绑定，teardown 时关闭。
 */
async function setupMcp(jai: PluginAPI, ctx: BuiltinPluginContext): Promise<void> {
	if (!ctx.mcpServers || Object.keys(ctx.mcpServers).length === 0) {
		jai.log.info("mcp: no mcpServers configured");
		return;
	}

	const configs: Record<string, McpServerConfig> = { ...ctx.mcpServers };
	const enabledCount = Object.values(configs).filter((c) => c.enabled !== false).length;
	if (enabledCount === 0) {
		jai.log.info("mcp: 0 enabled server(s)");
		return;
	}

	jai.log.info(`mcp: starting ${enabledCount} server(s)`);

	const manager = new McpManager({
		tokenStorePath: path.join(ctx.jaiHome, "mcp-tokens.json"),
		oauthRedirectUrl: ctx.oauthRedirectUrl,
	});
	const tools = await manager.start(configs);

	for (const tool of tools) {
		jai.registerTool(tool);
	}

	managerByCtx.set(ctx, manager);

	jai.log.info(`mcp: registered ${tools.length} tool(s)`);
}

async function teardownMcp(ctx: BuiltinPluginContext): Promise<void> {
	const manager = managerByCtx.get(ctx);
	if (!manager) return;
	managerByCtx.delete(ctx);
	await manager.closeAll();
}

/** 从 ctx 上拿 manager 句柄（gateway 用来暴露 status / reload）。 */
export function getMcpManager(ctx: BuiltinPluginContext): McpManager | undefined {
	return managerByCtx.get(ctx);
}

export const mcpBuiltin: BuiltinPluginDef = {
	meta: {
		name: "mcp",
		version: "0.1.0",
		description: "Builtin Model Context Protocol (MCP) plugin",
		rootPath: "",
	},
	setup: setupMcp,
	teardown: teardownMcp,
};
