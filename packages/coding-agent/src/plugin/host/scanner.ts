import { join } from "node:path";
import { z } from "zod";
import { loadPluginsFromDirs, type PluginConfigSchema, type ScanDir } from "./loader.js";

/** Declared env entry from a plugin manifest. */
export type PluginEnvEntry = {
	required?: boolean;
	description?: string;
};

/** One plugin's discovery + load status, as shown in the settings UI. */
export type PluginScanEntry = {
	name: string;
	version: string | null;
	description?: string;
	rootPath: string;
	status: "loaded" | "error";
	loadError?: string;
	/** Env declaration from plugin.json (empty object when none declared). */
	env: Record<string, PluginEnvEntry>;
	/**
	 * JSON Schema derived from the plugin's exported `configSchema` (zod).
	 * `null` when the plugin does not export a schema or when conversion fails.
	 */
	configSchema: Record<string, unknown> | null;
};

export type PluginScanResult = {
	entries: PluginScanEntry[];
};

export type ScanPluginsOptions = {
	jaiHome: string;
	pluginSettings: Record<string, unknown> | undefined;
	envSettings: Record<string, string> | undefined;
};

/**
 * Convert a zod-like schema to a JSON Schema using zod v4's built-in
 * `z.toJSONSchema`. Returns `null` for non-zod schemas or when conversion
 * throws — callers treat that as "no IntelliSense available".
 */
function toJsonSchema(schema: PluginConfigSchema | null): Record<string, unknown> | null {
	if (!schema) return null;
	try {
		const json = z.toJSONSchema(schema as unknown as z.ZodType);
		return json as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * Scan plugin directories using the given settings (env + plugin configs)
 * and return a unified list with load status.
 *
 * Only scans `<jaiHome>/plugins`; project-local plugin directories are not
 * supported.
 *
 * Safe to call repeatedly: `setup.command` is guarded by its `check` file,
 * and factory runs are idempotent against a throwaway registry.
 */
export async function scanPlugins(options: ScanPluginsOptions): Promise<PluginScanResult> {
	const dirs: ScanDir[] = [{ path: join(options.jaiHome, "plugins") }];

	const result = await loadPluginsFromDirs(dirs, {
		pluginSettings: options.pluginSettings,
		envSettings: options.envSettings,
	});

	const entries: PluginScanEntry[] = [];
	for (const p of result.loaded) {
		entries.push({
			name: p.meta.name,
			version: p.meta.version,
			description: p.meta.description,
			rootPath: p.meta.rootPath,
			status: "loaded",
			env: p.manifest.env ?? {},
			configSchema: toJsonSchema(p.configSchema),
		});
	}
	for (const err of result.errors) {
		entries.push({
			name: err.pluginName,
			version: null,
			rootPath: err.dir,
			status: "error",
			loadError: err.message,
			env: {},
			configSchema: null,
		});
	}
	return { entries };
}
