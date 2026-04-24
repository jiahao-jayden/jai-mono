import { z } from "zod";
import {
	CAPSULE_PROTOCOL_VERSION,
	type CapsuleActionDefinition,
	type CapsuleFallback,
	type CapsuleManifest,
	type JSONSchema,
} from "./types";

/** Author-facing action shape. Either a bare zod schema or one with metadata. */
export type CapsuleActionZodDef = z.ZodType | { schema: z.ZodType; description?: string };

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
	actions?: Record<string, CapsuleActionZodDef>;
	fallback?: CapsuleFallback;
	_meta?: Record<string, unknown>;
}

export interface BuildCapsuleManifestOptions {
	/** Path of the bundled ESM entry, relative to the emitted `capsule.json`. */
	entry: string;
}

/**
 * Convert an author-side `CapsuleDefinition` (zod schemas) to a wire-format
 * `CapsuleManifest` (JSON Schema). Accepts a bare definition or a capsule
 * module (whose `__capsule` static holds the definition).
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
	if (def.actions) manifest.actions = convertActions(def.actions);
	if (def.fallback) manifest.fallback = def.fallback;
	if (def._meta) manifest._meta = def._meta;
	return manifest;
}

function convertActions(actions: Record<string, CapsuleActionZodDef>): Record<string, CapsuleActionDefinition> {
	const out: Record<string, CapsuleActionDefinition> = {};
	for (const [id, raw] of Object.entries(actions)) {
		const schema = isZodSchema(raw) ? raw : raw.schema;
		const description = isZodSchema(raw) ? undefined : raw.description;
		const action: CapsuleActionDefinition = { schema: toJsonSchema(schema) };
		if (description !== undefined) action.description = description;
		out[id] = action;
	}
	return out;
}

function toJsonSchema(schema: z.ZodType): JSONSchema {
	return z.toJSONSchema(schema) as JSONSchema;
}

function isZodSchema(v: unknown): v is z.ZodType {
	return typeof v === "object" && v !== null && typeof (v as { parse?: unknown }).parse === "function";
}
