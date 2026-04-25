import type { AgentTool } from "@jayden/jai-agent";
import type {
	PluginAPI,
	PluginBootAPI,
	PluginCommandContext,
	PluginMeta,
	PreCompactHandler,
	PreModelRequestHandler,
	PreToolCallHandler,
} from "../types.js";
import type { PluginRegistry } from "./registry.js";
import type { ApiRouteRegistry } from "./route-registry.js";

export function createPluginAPI(
	registry: PluginRegistry,
	meta: PluginMeta,
	env: Readonly<Record<string, string | undefined>> = {},
	config: unknown = undefined,
): PluginAPI {
	const warn = (msg: string) => console.warn(`[plugin:${meta.name}] ${msg}`);

	return {
		meta,
		env: Object.freeze({ ...env }),
		config,
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

/**
 * Boot-context SDK factory. Used by the gateway when calling a plugin's
 * `boot(jai)` named export at process startup.
 *
 * The boot API is intentionally narrower than `PluginAPI` — it can only
 * register HTTP routes (plus shared meta/log/env/config). Session-scoped
 * capabilities live on `PluginAPI` and are unavailable here.
 */
export function createBootPluginAPI(
	routes: ApiRouteRegistry,
	meta: PluginMeta,
	env: Readonly<Record<string, string | undefined>> = {},
	config: unknown = undefined,
): PluginBootAPI {
	return {
		meta,
		env: Object.freeze({ ...env }),
		config,
		log: {
			info: (msg, data) => console.info(`[plugin:${meta.name}] ${msg}`, data ?? ""),
			warn: (msg, data) => console.warn(`[plugin:${meta.name}] ${msg}`, data ?? ""),
			error: (msg, data) => console.error(`[plugin:${meta.name}] ${msg}`, data ?? ""),
		},
		registerApiRoute(method, path, handler) {
			routes.add(meta, method, path, handler);
		},
	};
}
