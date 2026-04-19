// packages/coding-agent/src/plugin/index.ts

export { defineAgentTool as defineTool } from "@jayden/jai-agent";
export { definePlugin } from "./sdk/define.js";
export type {
	PluginAPI,
	PluginCommandContext,
	PluginContext,
	PluginFactory,
	PluginMeta,
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
