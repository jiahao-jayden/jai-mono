import { z } from "zod";
import { CAPSULE_PROTOCOL_VERSION, type CapsuleManifest } from "./types";

export interface ManifestValidationIssue {
	path: string;
	message: string;
}

export interface ManifestValidationResult {
	ok: boolean;
	issues: ManifestValidationIssue[];
}

const jsonSchemaObject = z.record(z.string(), z.unknown());

const actionDefinitionSchema = z.object({
	schema: jsonSchemaObject,
	description: z.string().optional(),
});

/**
 * Normative manifest shape. `.passthrough()` enforces SPEC §4.2 — unknown
 * top-level fields are preserved and ignored rather than rejected.
 */
export const capsuleManifestSchema = z
	.object({
		protocol: z.literal(CAPSULE_PROTOCOL_VERSION),
		id: z.string().min(1),
		version: z.string().min(1),
		title: z.string().optional(),
		description: z.string().optional(),
		entry: z.string().min(1),
		dataSchema: jsonSchemaObject,
		actions: z
			.record(
				z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "action id must match /^[a-zA-Z_][a-zA-Z0-9_]*$/"),
				actionDefinitionSchema,
			)
			.optional(),
		fallback: z.object({ text: z.string().optional() }).optional(),
		_meta: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

export function validateCapsuleManifest(input: unknown): ManifestValidationResult {
	const parsed = capsuleManifestSchema.safeParse(input);
	if (parsed.success) return { ok: true, issues: [] };
	return {
		ok: false,
		issues: parsed.error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		})),
	};
}

export function assertCapsuleManifest(input: unknown): asserts input is CapsuleManifest {
	const result = validateCapsuleManifest(input);
	if (result.ok) return;
	const summary = result.issues.map((i) => `  - ${i.path || "<root>"}: ${i.message}`).join("\n");
	throw new Error(`Invalid capsule manifest:\n${summary}`);
}

/** Resolve `{path.to.field}` placeholders; unknown paths render as `""`. */
export function renderFallbackText(template: string, data: unknown): string {
	return template.replace(/\{([^{}]+)\}/g, (_match, rawPath: string) => {
		const segments = rawPath.trim().split(".");
		let cursor: unknown = data;
		for (const seg of segments) {
			if (cursor == null) return "";
			if (typeof cursor !== "object") return "";
			cursor = (cursor as Record<string, unknown>)[seg];
		}
		if (cursor == null) return "";
		if (typeof cursor === "object") return JSON.stringify(cursor);
		return String(cursor);
	});
}
