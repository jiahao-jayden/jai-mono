import { describe, expect, test } from "bun:test";
import {
	assertCapsuleManifest,
	CAPSULE_PROTOCOL_VERSION,
	type CapsuleManifest,
	renderFallbackText,
	validateCapsuleManifest,
} from "../src/index";

const baseManifest = (
	overrides: Partial<CapsuleManifest> = {},
): CapsuleManifest => ({
	protocol: CAPSULE_PROTOCOL_VERSION,
	id: "weather",
	version: "1.0.0",
	entry: "./index.js",
	dataSchema: { type: "object" },
	...overrides,
});

describe("validateCapsuleManifest", () => {
	test("accepts a minimal valid manifest", () => {
		const result = validateCapsuleManifest(baseManifest());
		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
	});

	test("rejects non-object input", () => {
		const r = validateCapsuleManifest(null);
		expect(r.ok).toBe(false);
		expect(r.issues[0].path).toBe("");
	});

	test("rejects wrong protocol version", () => {
		const r = validateCapsuleManifest({
			...baseManifest(),
			protocol: "capsule/v1",
		});
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.path === "protocol")).toBe(true);
	});

	test("requires id / version / entry", () => {
		const r = validateCapsuleManifest({
			protocol: CAPSULE_PROTOCOL_VERSION,
			dataSchema: {},
		});
		const paths = r.issues.map((i) => i.path).sort();
		expect(paths).toContain("id");
		expect(paths).toContain("version");
		expect(paths).toContain("entry");
	});

	test("requires dataSchema to be an object", () => {
		const r = validateCapsuleManifest({
			...baseManifest(),
			dataSchema: "not-an-object",
		});
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.path === "dataSchema")).toBe(true);
	});

	test("rejects invalid action ids", () => {
		const r = validateCapsuleManifest(
			baseManifest({
				actions: {
					"bad-id": { schema: {} },
				},
			}),
		);
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.path === "actions.bad-id")).toBe(true);
	});

	test("accepts well-formed actions", () => {
		const r = validateCapsuleManifest(
			baseManifest({
				actions: {
					refresh: { schema: { type: "object" }, description: "Reload" },
					expand: { schema: { type: "object" } },
				},
			}),
		);
		expect(r.ok).toBe(true);
	});

	test("validates fallback.text as string", () => {
		const r = validateCapsuleManifest(
			baseManifest({
				// biome-ignore lint/suspicious/noExplicitAny: testing invalid input
				fallback: { text: 42 } as any,
			}),
		);
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.path === "fallback.text")).toBe(true);
	});

	test("ignores unknown top-level fields (forward-compat)", () => {
		const r = validateCapsuleManifest({
			...baseManifest(),
			experimentalField: "whatever",
			_meta: { anything: true },
		});
		expect(r.ok).toBe(true);
	});
});

describe("assertCapsuleManifest", () => {
	test("is a no-op for valid input", () => {
		expect(() => assertCapsuleManifest(baseManifest())).not.toThrow();
	});

	test("throws with a readable summary on invalid input", () => {
		try {
			assertCapsuleManifest({ protocol: "wrong" });
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toContain("Invalid capsule manifest");
			expect((err as Error).message).toContain("protocol");
		}
	});
});

describe("renderFallbackText", () => {
	test("resolves flat placeholders", () => {
		const out = renderFallbackText("{city}: {temp}°C", {
			city: "Beijing",
			temp: 21,
		});
		expect(out).toBe("Beijing: 21°C");
	});

	test("resolves nested paths", () => {
		const out = renderFallbackText("{user.name}", { user: { name: "Jay" } });
		expect(out).toBe("Jay");
	});

	test("renders missing paths as empty string", () => {
		const out = renderFallbackText("[{missing}]", {});
		expect(out).toBe("[]");
	});

	test("JSON-stringifies non-scalar leaves", () => {
		const out = renderFallbackText("{items}", { items: [1, 2] });
		expect(out).toBe("[1,2]");
	});

	test("preserves text without placeholders", () => {
		expect(renderFallbackText("static", {})).toBe("static");
	});
});
