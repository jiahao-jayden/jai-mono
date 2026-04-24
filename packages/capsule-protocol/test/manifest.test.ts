import { describe, expect, test } from "bun:test";
import { assertCapsuleManifest, renderFallbackText, validateCapsuleManifest } from "../src/manifest";

const base = {
	protocol: "capsule/v0" as const,
	id: "weather",
	version: "1.0.0",
	entry: "./index.js",
	dataSchema: { type: "object" },
};

describe("validateCapsuleManifest", () => {
	test("accepts a minimal valid manifest", () => {
		expect(validateCapsuleManifest(base)).toEqual({ ok: true, issues: [] });
	});

	test("rejects wrong protocol version", () => {
		const result = validateCapsuleManifest({ ...base, protocol: "capsule/v1" });
		expect(result.ok).toBe(false);
		expect(result.issues.some((i) => i.path === "protocol")).toBe(true);
	});

	test("rejects empty id/version/entry", () => {
		const result = validateCapsuleManifest({ ...base, id: "", version: "", entry: "" });
		expect(result.ok).toBe(false);
		const paths = new Set(result.issues.map((i) => i.path));
		expect(paths.has("id")).toBe(true);
		expect(paths.has("version")).toBe(true);
		expect(paths.has("entry")).toBe(true);
	});

	test("rejects action id with invalid characters", () => {
		const result = validateCapsuleManifest({
			...base,
			actions: { "not-valid": { schema: { type: "object" } } },
		});
		expect(result.ok).toBe(false);
		expect(result.issues.some((i) => i.path.startsWith("actions"))).toBe(true);
	});

	test("preserves unknown top-level fields (forward compat)", () => {
		const result = validateCapsuleManifest({ ...base, experimentalField: 123 });
		expect(result.ok).toBe(true);
	});

	test("assertCapsuleManifest throws with a readable summary on invalid input", () => {
		expect(() => assertCapsuleManifest({ ...base, protocol: "nope" })).toThrow(/Invalid capsule manifest/);
	});
});

describe("renderFallbackText", () => {
	test("replaces flat placeholders", () => {
		expect(renderFallbackText("{city}: {temp}°C", { city: "Shanghai", temp: 22 })).toBe("Shanghai: 22°C");
	});

	test("walks dotted paths", () => {
		expect(renderFallbackText("{location.city}", { location: { city: "Tokyo" } })).toBe("Tokyo");
	});

	test("missing paths render as empty string", () => {
		expect(renderFallbackText("a={a} b={b}", { a: 1 })).toBe("a=1 b=");
	});

	test("non-scalar leaves are JSON-stringified", () => {
		expect(renderFallbackText("{arr}", { arr: [1, 2] })).toBe("[1,2]");
	});
});
