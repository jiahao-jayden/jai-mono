// packages/coding-agent/src/plugin/index.ts

export { defineAgentTool as defineTool } from "@jayden/jai-agent";
export type { BootLoadError, BootLoadOptions, BootLoadResult } from "./host/boot-loader.js";
export { loadPluginRoutes } from "./host/boot-loader.js";
export { ApiRouteRegistry, type RegisteredApiRoute } from "./host/route-registry.js";
export { definePlugin, definePluginBoot } from "./sdk/define.js";
export type {
	PluginAPI,
	PluginBootAPI,
	PluginBootFactory,
	PluginCommandContext,
	PluginContext,
	PluginFactory,
	PluginMeta,
	PluginRouteHandler,
	PluginRouteMethod,
	PreCompactEvent,
	PreCompactHandler,
	PreCompactResult,
	PreModelRequestEvent,
	PreModelRequestHandler,
	PreModelRequestResult,
	PreToolCallEvent,
	PreToolCallHandler,
	PreToolCallResult,
	RegisteredCommand,
} from "./types.js";
