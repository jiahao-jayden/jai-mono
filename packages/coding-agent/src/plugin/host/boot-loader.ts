import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PluginMeta } from "../types.js";
import { createBootPluginAPI } from "./api-factory.js";
import { importPluginModule } from "./loader.js";
import { loadManifest } from "./manifest.js";
import { ApiRouteRegistry } from "./route-registry.js";

export type BootLoadOptions = {
	jaiHome: string;
	/** Optional per-plugin config map (mirrors `LoadOptions.pluginSettings`). */
	pluginSettings?: Readonly<Record<string, unknown>>;
	/** Optional shared env map (mirrors `LoadOptions.envSettings`). */
	envSettings?: Readonly<Record<string, string>>;
};

export type BootLoadError = {
	pluginName: string;
	dir: string;
	message: string;
};

export type BootLoadResult = {
	/** Process-level HTTP route registry, populated by all successful `boot()` calls. */
	routes: ApiRouteRegistry;
	/** Plugins whose `boot()` was successfully invoked. */
	loaded: PluginMeta[];
	/** Plugins that errored during manifest read or `boot()` execution. */
	errors: BootLoadError[];
};

async function listPluginDirs(root: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const out: string[] = [];
	for (const e of entries) {
		const full = join(root, e.name);
		if (e.isDirectory()) {
			out.push(full);
			continue;
		}
		// Follow symlinks: `ln -s <repo>/examples/foo ~/.jai/plugins/foo` is the
		// recommended dev install; without resolving symlinks the linked plugin
		// would be invisible.
		if (e.isSymbolicLink()) {
			try {
				const s = await stat(full);
				if (s.isDirectory()) out.push(full);
			} catch {
				// dangling link, skip
			}
		}
	}
	return out;
}

/**
 * Process-level plugin boot loader.
 *
 * Scans `<jaiHome>/plugins`, imports each plugin's module, and — for plugins
 * that export a `boot` function — calls it with a narrow `PluginBootAPI` so
 * the plugin can register HTTP routes.
 *
 * Boundaries:
 *  - Does NOT touch `SessionManager`, `AgentSession`, or any session-scoped
 *    plugin lifecycle. Session-time loading still runs via
 *    `loadPluginsFromDirs` and only invokes `default` factories.
 *  - Failures are collected per-plugin; one bad plugin does not stop others.
 *  - Routes contributed by a plugin are dropped if its `boot` throws.
 */
export async function loadPluginRoutes(options: BootLoadOptions): Promise<BootLoadResult> {
	const routes = new ApiRouteRegistry();
	const loaded: PluginMeta[] = [];
	const errors: BootLoadError[] = [];
	const seen = new Set<string>();

	const root = join(options.jaiHome, "plugins");
	const dirs = await listPluginDirs(root);

	for (const dir of dirs) {
		let manifest: Awaited<ReturnType<typeof loadManifest>>;
		try {
			manifest = await loadManifest(dir);
		} catch (err: unknown) {
			errors.push({
				pluginName: "<unknown>",
				dir,
				message: `Manifest error: ${err instanceof Error ? err.message : String(err)}`,
			});
			continue;
		}
		if (!manifest) continue;
		if (seen.has(manifest.name)) continue;
		seen.add(manifest.name);

		const meta: PluginMeta = {
			name: manifest.name,
			version: manifest.version,
			description: manifest.description,
			rootPath: dir,
		};

		try {
			const { boot } = await importPluginModule(dir);
			if (!boot) continue;

			const env: Record<string, string | undefined> = { ...(options.envSettings ?? {}) };
			const config = options.pluginSettings?.[manifest.name];
			const api = createBootPluginAPI(routes, meta, env, config);
			await boot(api);
			loaded.push(meta);
		} catch (err: unknown) {
			routes.removeByPlugin(meta.name);
			errors.push({
				pluginName: meta.name,
				dir,
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return { routes, loaded, errors };
}
