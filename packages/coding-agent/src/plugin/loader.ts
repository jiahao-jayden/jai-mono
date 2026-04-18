import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPluginAPI } from "./api-factory.js";
import { expandTemplate, loadCommandTemplatesFromDir } from "./commands.js";
import { loadManifest, type PluginManifest } from "./manifest.js";
import { PluginRegistry } from "./registry.js";
import type { PluginCommandContext, PluginFactory, PluginMeta } from "./types.js";
import type { Dirent } from "node:fs";

export type ScanDir = { path: string; scope: "project" | "user" };

export type LoadedPlugin = {
  meta: PluginMeta;
  manifest: PluginManifest;
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

async function importFactory(pluginDir: string): Promise<PluginFactory | null> {
  for (const filename of ["index.ts", "index.js"]) {
    const full = join(pluginDir, filename);
    try {
      await access(full); // throws ENOENT if missing
    } catch {
      continue; // file not present, try next
    }
    // File exists — any error from here is a real load error, propagate
    const mod = await import(pathToFileURL(full).href);
    const factory = mod?.default;
    if (typeof factory === "function") return factory as PluginFactory;
    // If the file had no default export, fall through to try the next filename.
  }
  return null;
}

export async function loadPluginsFromDirs(dirs: ScanDir[]): Promise<LoadResult> {
  const registry = new PluginRegistry();
  const loaded: LoadedPlugin[] = [];
  const errors: LoadError[] = [];
  const seenNames = new Set<string>();

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

      if (seenNames.has(manifest.name)) continue; // earlier scan (higher priority) wins
      seenNames.add(manifest.name);

      const meta: PluginMeta = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        rootPath: dir,
        scope: scan.scope,
      };

      try {
        // 1. index.ts factory (if present)
        const factory = await importFactory(dir);
        if (factory) {
          const api = createPluginAPI(registry, meta);
          await factory(api);
        }

        // 2. commands/*.md
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

        loaded.push({ meta, manifest });
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
