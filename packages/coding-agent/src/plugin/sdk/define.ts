import type { PluginBootFactory, PluginFactory } from "../types.js";

/** Type-only helper to get full IDE hints when authoring a plugin. */
export function definePlugin(factory: PluginFactory): PluginFactory {
	return factory;
}

/**
 * Type-only helper for the named `boot` export. Use when you want IDE
 * autocomplete on the boot SDK without manually typing the parameter:
 *
 * ```ts
 * export const boot = definePluginBoot((jai) => {
 *   jai.registerApiRoute("GET", "/hello", () => new Response("hi"));
 * });
 * ```
 */
export function definePluginBoot(boot: PluginBootFactory): PluginBootFactory {
	return boot;
}
