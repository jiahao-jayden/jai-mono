import type { AgentTool } from "@jayden/jai-agent";
import type { PluginRegistry } from "./registry.js";
import type {
  PluginAPI,
  PluginCommandContext,
  PluginMeta,
  PreCompactHandler,
  PreModelRequestHandler,
  PreToolCallHandler,
} from "./types.js";

export function createPluginAPI(registry: PluginRegistry, meta: PluginMeta): PluginAPI {
  const warn = (msg: string) => console.warn(`[plugin:${meta.name}] ${msg}`);

  return {
    meta,
    log: {
      info: (msg, data) => console.info(`[plugin:${meta.name}] ${msg}`, data ?? ""),
      warn: (msg, data) => console.warn(`[plugin:${meta.name}] ${msg}`, data ?? ""),
      error: (msg, data) => console.error(`[plugin:${meta.name}] ${msg}`, data ?? ""),
    },
    on(event, handler) {
      switch (event) {
        case "preToolCall":
          registry.addPreToolCall(meta, handler as PreToolCallHandler);
          break;
        case "preModelRequest":
          registry.addPreModelRequest(meta, handler as PreModelRequestHandler);
          break;
        case "preCompact":
          registry.addPreCompact(meta, handler as PreCompactHandler);
          break;
      }
    },
    registerTool(def: AgentTool) {
      registry.addTool(meta, def, warn);
    },
    registerCommand(
      name,
      opts: {
        description?: string;
        argumentHint?: string;
        handler: (args: string, ctx: PluginCommandContext) => Promise<void> | void;
      },
    ) {
      registry.addCommand(meta, { commandName: name, ...opts });
    },
  };
}
