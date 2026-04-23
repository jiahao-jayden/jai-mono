import type { Dirent } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginCommandContext, PluginFactory, PluginMeta } from "../types.js";
import { createPluginAPI } from "./api-factory.js";
import { expandTemplate, loadCommandTemplatesFromDir } from "./commands.js";
import { loadManifest, type PluginManifest } from "./manifest.js";
import { PluginRegistry } from "./registry.js";

/** Resolve declared plugin env from settings.json -> env. */
function resolvePluginEnv(
	manifest: PluginManifest,
	settingsEnv: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string | undefined>> {
	const decl = manifest.env;
	if (!decl) return Object.freeze({});

	const result: Record<string, string | undefined> = {};
	const missing: string[] = [];
	for (const [key, entry] of Object.entries(decl)) {
		const value = settingsEnv[key];
		result[key] = value;
		if (entry.required && (value === undefined || value === "")) {
			missing.push(key);
		}
	}
	if (missing.length > 0) {
		throw new Error(`Missing required env: ${missing.join(", ")}. Declared in plugin.json → "env".`);
	}
	return Object.freeze(result);
}

/** Warn if the plugin entry file references process.env directly. */
async function warnIfProcessEnvUsed(pluginDir: string, pluginName: string): Promise<void> {
	for (const filename of ["index.ts", "index.js"]) {
		const full = join(pluginDir, filename);
		let source: string;
		try {
			source = await readFile(full, "utf8");
		} catch {
			continue;
		}
		if (/\bprocess\.env\b/.test(source)) {
			console.warn(
				`[plugin:${pluginName}] uses process.env in ${filename}. ` +
					`Plugins must declare env in plugin.json and read via jai.env.`,
			);
		}
		return;
	}
}

/** Run manifest setup.command when setup.check is missing. */
async function runSetupIfNeeded(pluginDir: string, manifest: PluginManifest): Promise<void> {
	const setup = manifest.setup;
	if (!setup) return;

	const checkPath = join(pluginDir, setup.check);
	try {
		await access(checkPath);
		return;
	} catch {}

	const proc = Bun.spawn(["sh", "-c", setup.command], {
		cwd: pluginDir,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [exitCode, stderrText] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

	if (exitCode !== 0) {
		const stderrSnippet = stderrText.trim().slice(-400);
		throw new Error(
			`Plugin setup failed (exit ${exitCode}) in ${pluginDir}\n` +
				`  command: ${setup.command}\n` +
				(stderrSnippet ? `  stderr: ${stderrSnippet}` : ""),
		);
	}
}

export type ScanDir = { path: string };

export type LoadedPlugin = {
	meta: PluginMeta;
	manifest: PluginManifest;
	/** Raw schema exported by the plugin (typically a zod schema). */
	configSchema: PluginConfigSchema | null;
};

export type LoadError = {
	pluginName: string;
	dir: string;
	message: string;
};

export type LoadResult = {
	registry: PluginRegistry;
	loaded: LoadedPlugin[];
	errors: LoadError[];
};

async function listPluginDirs(root: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
}

/** Optional plugin config schema export (duck-typed zod-like). */
export type PluginConfigSchema = {
	safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: unknown };
};

function isPluginConfigSchema(v: unknown): v is PluginConfigSchema {
	return typeof v === "object" && v !== null && typeof (v as { safeParse?: unknown }).safeParse === "function";
}

type PluginModule = {
	factory: PluginFactory | null;
	configSchema: PluginConfigSchema | null;
};

async function importPluginModule(pluginDir: string): Promise<PluginModule> {
	for (const filename of ["index.ts", "index.js"]) {
		const full = join(pluginDir, filename);
		try {
			await access(full);
		} catch {
			continue;
		}
		const mod = await import(pathToFileURL(full).href);
		const factory = typeof mod?.default === "function" ? (mod.default as PluginFactory) : null;
		const configSchema = isPluginConfigSchema(mod?.configSchema) ? mod.configSchema : null;
		if (factory || configSchema) {
			return { factory, configSchema };
		}
	}
	return { factory: null, configSchema: null };
}

/** Validate raw plugin config when configSchema is exported. */
function resolvePluginConfig(pluginName: string, raw: unknown, schema: PluginConfigSchema | null): unknown {
	if (!schema) return raw;
	const result = schema.safeParse(raw);
	if (!result.success) {
		throw new Error(
			`Plugin config validation failed for "${pluginName}". ` +
				`Check settings.json → plugins.${pluginName}. ` +
				`Error: ${String((result.error as { message?: string })?.message ?? result.error)}`,
		);
	}
	return result.data;
}

export type LoadOptions = {
	pluginSettings?: Readonly<Record<string, unknown>>;
	envSettings?: Readonly<Record<string, string>>;
};

export async function loadPluginsFromDirs(dirs: ScanDir[], options: LoadOptions = {}): Promise<LoadResult> {
	const registry = new PluginRegistry();
	const loaded: LoadedPlugin[] = [];
	const errors: LoadError[] = [];
	const seenNames = new Set<string>();
	const pluginSettings = options.pluginSettings ?? {};
	const envSettings = options.envSettings ?? {};

	for (const scan of dirs) {
		const pluginDirs = await listPluginDirs(scan.path);
		for (const dir of pluginDirs) {
			let manifest: PluginManifest | null = null;
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

			if (seenNames.has(manifest.name)) continue;
			seenNames.add(manifest.name);

			const meta: PluginMeta = {
				name: manifest.name,
				version: manifest.version,
				description: manifest.description,
				rootPath: dir,
			};

			try {
				await runSetupIfNeeded(dir, manifest);
				const env = resolvePluginEnv(manifest, envSettings);
				await warnIfProcessEnvUsed(dir, manifest.name);
				const { factory, configSchema } = await importPluginModule(dir);
				const rawConfig = pluginSettings[manifest.name];
				const config = resolvePluginConfig(manifest.name, rawConfig, configSchema);
				if (factory) {
					const api = createPluginAPI(registry, meta, env, config);
					await factory(api);
				}

				const templates = await loadCommandTemplatesFromDir(join(dir, "commands"));
				for (const tpl of templates) {
					registry.addCommand(meta, {
						commandName: tpl.name,
						description: tpl.description,
						argumentHint: tpl.argumentHint,
						handler: async (args: string, ctx: PluginCommandContext) => {
							const expanded = expandTemplate(tpl.content, args);
							await ctx.sendUserMessage(expanded);
						},
					});
				}

				loaded.push({ meta, manifest, configSchema });
			} catch (err: unknown) {
				registry.removeByPlugin(meta.name);
				errors.push({
					pluginName: manifest.name,
					dir,
					message: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	return { registry, loaded, errors };
}
