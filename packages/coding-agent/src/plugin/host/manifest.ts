import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const setupSchema = z.object({
	/** Path (relative to plugin dir) whose existence means setup is already done. */
	check: z.string().min(1),
	/** Shell command to run in the plugin dir when `check` is missing. */
	command: z.string().min(1),
});

/**
 * Per-env declaration. Plugin authors declare each env var they need so the
 * host can validate required ones at load time and inject only declared keys
 * into `jai.env` (plugins must not read `process.env` directly).
 */
export const envEntrySchema = z.object({
	required: z.boolean().optional().default(false),
	description: z.string().optional(),
});

/** Map of ENV_NAME → declaration. Key must be SCREAMING_SNAKE_CASE. */
export const envSchema = z.record(
	z.string().regex(/^[A-Z][A-Z0-9_]*$/, "env name must be SCREAMING_SNAKE_CASE"),
	envEntrySchema,
);

export const manifestSchema = z
	.object({
		name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case lowercase"),
		version: z.string().min(1),
		description: z.string().optional(),
		author: z.string().optional(),
		homepage: z.string().optional(),
		/**
		 * Optional one-time setup step, run before `index.ts` is imported.
		 * Runtime-agnostic: works for npm, pip, cargo, or any shell-callable task.
		 */
		setup: setupSchema.optional(),
		/**
		 * Declared environment variables this plugin reads.
		 * Only declared keys are exposed via `jai.env`; undeclared keys are hidden.
		 * `required: true` entries that are missing at load time cause a LoadError.
		 */
		env: envSchema.optional(),
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
