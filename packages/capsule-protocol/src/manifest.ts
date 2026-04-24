import { CAPSULE_PROTOCOL_VERSION, type CapsuleManifest } from "./types";

export interface ManifestValidationIssue {
	path: string;
	message: string;
}

export interface ManifestValidationResult {
	ok: boolean;
	issues: ManifestValidationIssue[];
}

export function validateCapsuleManifest(input: unknown): ManifestValidationResult {
	const issues: ManifestValidationIssue[] = [];
	const push = (path: string, message: string) => issues.push({ path, message });

	if (!isRecord(input)) {
		return {
			ok: false,
			issues: [{ path: "", message: "manifest must be an object" }],
		};
	}

	if (input.protocol !== CAPSULE_PROTOCOL_VERSION) {
		push("protocol", `expected "${CAPSULE_PROTOCOL_VERSION}", got ${JSON.stringify(input.protocol)}`);
	}

	requireString(input, "id", push);
	requireString(input, "version", push);
	requireString(input, "entry", push);

	if (input.title !== undefined && typeof input.title !== "string") {
		push("title", "must be a string when present");
	}
	if (input.description !== undefined && typeof input.description !== "string") {
		push("description", "must be a string when present");
	}

	if (!isRecord(input.dataSchema)) {
		push("dataSchema", "must be a JSON Schema object");
	}

	if (input.actions !== undefined) {
		if (!isRecord(input.actions)) {
			push("actions", "must be an object mapping id → action definition");
		} else {
			for (const [actionId, def] of Object.entries(input.actions)) {
				if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(actionId)) {
					push(`actions.${actionId}`, "action id must match /^[a-zA-Z_][a-zA-Z0-9_]*$/");
				}
				if (!isRecord(def)) {
					push(`actions.${actionId}`, "must be an object");
					continue;
				}
				if (!isRecord(def.schema)) {
					push(`actions.${actionId}.schema`, "must be a JSON Schema object");
				}
				if (def.description !== undefined && typeof def.description !== "string") {
					push(`actions.${actionId}.description`, "must be a string when present");
				}
			}
		}
	}

	if (input.fallback !== undefined) {
		if (!isRecord(input.fallback)) {
			push("fallback", "must be an object");
		} else if (input.fallback.text !== undefined && typeof input.fallback.text !== "string") {
			push("fallback.text", "must be a string when present");
		}
	}

	return { ok: issues.length === 0, issues };
}

export function assertCapsuleManifest(input: unknown): asserts input is CapsuleManifest {
	const { ok, issues } = validateCapsuleManifest(input);
	if (ok) return;
	const summary = issues.map((i) => `  - ${i.path || "<root>"}: ${i.message}`).join("\n");
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

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(
	obj: Record<string, unknown>,
	field: string,
	push: (path: string, message: string) => void,
): void {
	const v = obj[field];
	if (typeof v !== "string" || v.length === 0) {
		push(field, "is required and must be a non-empty string");
	}
}
