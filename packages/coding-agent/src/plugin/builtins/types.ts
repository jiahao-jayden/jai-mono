import type { PluginAPI, PluginMeta } from "../types.js";
import type { McpServerConfig } from "./mcp/types.js";
import type { InvokedSkillInfo } from "./skills/types.js";

/**
 * 共享给所有 builtin 插件的 session-scoped context。
 *
 * 加新 builtin 时，把它需要的字段加在这里——这是唯一的接缝。
 * `setup` 通过 destructure 取自己关心的部分。
 */
export interface BuiltinPluginContext {
	cwd: string;
	jaiHome: string;
	/** 用户在 settings.json 配置的 plugin 配置 dict（settings.plugins） */
	pluginSettings: Readonly<Record<string, unknown>>;
	/** 用户在 settings.json 配置的 mcpServers */
	mcpServers?: Readonly<Record<string, McpServerConfig>>;
	/** Gateway 暴露的 OAuth 回调 URL；MCP HTTP server 用它走授权码流。 */
	oauthRedirectUrl?: string;
	onSkillInvoked: (info: InvokedSkillInfo) => void;
}

export type BuiltinPluginDef = {
	meta: PluginMeta;
	/** 在该 builtin 启用前快速决定。返回 false 则跳过 setup。 */
	enabled?: (ctx: BuiltinPluginContext) => boolean | Promise<boolean>;
	setup: (jai: PluginAPI, ctx: BuiltinPluginContext) => Promise<void> | void;
	/** session 关闭时调用，用于关闭子进程、断开 MCP 连接等。 */
	teardown?: (ctx: BuiltinPluginContext) => Promise<void> | void;
};
