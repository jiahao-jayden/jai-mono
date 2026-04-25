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

const componentManifestSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	dataSchema: jsonSchemaObject,
});

/**
 * Normative manifest shape. `.passthrough()` enforces forward compatibility —
 * unknown top-level fields are preserved and ignored rather than rejected.
 */
export const capsuleManifestSchema = z
	.object({
		protocol: z.literal(CAPSULE_PROTOCOL_VERSION),
		id: z.string().min(1),
		version: z.string().min(1),
		entry: z.string().min(1),
		components: z.record(z.string(), componentManifestSchema),
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
