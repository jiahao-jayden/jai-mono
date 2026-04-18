import type { PluginFactory } from "../types.js";

/** Type-only helper to get full IDE hints when authoring a plugin. */
export function definePlugin(factory: PluginFactory): PluginFactory {
  return factory;
}
