import { z } from "zod";
import {
	CAPSULE_PROTOCOL_VERSION,
	type CapsuleFallback,
	type CapsuleManifest,
	type JSONSchema,
} from "./types";

/**
 * Static description of a capsule as written by its author (zod-first).
 * Converted to the wire-format `CapsuleManifest` by `buildCapsuleManifest()`
 * at build time.
 */
export interface CapsuleDefinition {
	id: string;
	version: string;
	title?: string;
	description?: string;
	dataSchema: z.ZodType;
	fallback?: CapsuleFallback;
	_meta?: Record<string, unknown>;
}

export interface BuildCapsuleManifestOptions {
	/** Path of the bundled ESM entry, relative to the emitted `capsule.json`. */
	entry: string;
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

	const manifest: CapsuleManifest = {
		protocol: CAPSULE_PROTOCOL_VERSION,
		id: def.id,
		version: def.version,
		entry: options.entry,
		dataSchema: toJsonSchema(def.dataSchema),
	};
	if (def.title !== undefined) manifest.title = def.title;
	if (def.description !== undefined) manifest.description = def.description;
	if (def.fallback) manifest.fallback = def.fallback;
	if (def._meta) manifest._meta = def._meta;
	return manifest;
}

function toJsonSchema(schema: z.ZodType): JSONSchema {
	return z.toJSONSchema(schema) as JSONSchema;
}
