import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const manifestSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case lowercase"),
    version: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
    homepage: z.string().optional(),
  })
  .passthrough(); // forward-compat: unknown fields (mcpServers etc.) pass through

export type PluginManifest = z.infer<typeof manifestSchema>;

/** Load and validate plugin.json from a directory. Returns null if plugin.json missing. */
export async function loadManifest(dir: string): Promise<PluginManifest | null> {
  const path = join(dir, "plugin.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const json = JSON.parse(raw);
  return manifestSchema.parse(json);
}
