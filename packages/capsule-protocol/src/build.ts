import { z } from "zod";
import {
	CAPSULE_PROTOCOL_VERSION,
	type CapsuleComponentManifest,
	type CapsuleManifest,
	type JSONSchema,
} from "./types";

/**
 * Static description of a capsule as written by its author (zod-first).
 * Converted to the wire-format `CapsuleManifest` by `buildCapsuleManifest()`.
 */
export interface CapsuleDefinition {
	id: string;
	version: string;
	components: Record<string, z.ZodType>;
}

export interface BuildCapsuleManifestOptions {
	/** Path of the bundled ESM entry, relative to the emitted `capsule.json`. */
	entry: string;
	/** Optional per-component metadata (title, description) not captured in zod schemas. */
	componentMeta?: Record<string, { title?: string; description?: string }>;
}

/**
 * Convert an author-side `CapsuleDefinition` (zod schemas) to a wire-format
 * `CapsuleManifest` (JSON Schema).
 */
export function buildCapsuleManifest(
	input: CapsuleDefinition | { __capsule: CapsuleDefinition },
	options: BuildCapsuleManifestOptions,
): CapsuleManifest {
	const def = "__capsule" in input ? input.__capsule : input;

	const components: Record<string, CapsuleComponentManifest> = {};
	for (const [key, schema] of Object.entries(def.components)) {
		const meta = options.componentMeta?.[key];
		const comp: CapsuleComponentManifest = {
			dataSchema: toJsonSchema(schema),
		};
		if (meta?.title !== undefined) comp.title = meta.title;
		if (meta?.description !== undefined) comp.description = meta.description;
		components[key] = comp;
	}

	const manifest: CapsuleManifest = {
		protocol: CAPSULE_PROTOCOL_VERSION,
		id: def.id,
		version: def.version,
		entry: options.entry,
		components,
	};
	return manifest;
}

function toJsonSchema(schema: z.ZodType): JSONSchema {
	return z.toJSONSchema(schema) as JSONSchema;
}
