import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildCapsuleManifest } from "../src/build";
import { validateCapsuleManifest } from "../src/manifest";
import { defineCapsule } from "../src/runtime";
import { CAPSULE_PROTOCOL_VERSION } from "../src/types";

describe("buildCapsuleManifest", () => {
	test("converts zod dataSchema to JSON Schema in the wire manifest", () => {
		const manifest = buildCapsuleManifest(
			{
				id: "weather",
				version: "1.0.0",
				dataSchema: z.object({
					city: z.string(),
					temp: z.number(),
				}),
			},
			{ entry: "./index.js" },
		);

		expect(manifest.protocol).toBe(CAPSULE_PROTOCOL_VERSION);
		expect(manifest.id).toBe("weather");
		expect(manifest.entry).toBe("./index.js");
		expect(manifest.dataSchema.type).toBe("object");
		expect((manifest.dataSchema.properties as Record<string, unknown>).city).toBeDefined();
		expect((manifest.dataSchema.properties as Record<string, unknown>).temp).toBeDefined();
	});

	test("accepts actions as bare zod schemas and converts them", () => {
		const manifest = buildCapsuleManifest(
			{
				id: "counter",
				version: "1.0.0",
				dataSchema: z.object({ count: z.number() }),
				actions: {
					increment: z.object({ by: z.number() }),
				},
			},
			{ entry: "./index.js" },
		);

		expect(manifest.actions?.increment.schema.type).toBe("object");
		expect((manifest.actions?.increment.schema.properties as Record<string, unknown>).by).toBeDefined();
	});

	test("accepts actions with explicit description wrapper", () => {
		const manifest = buildCapsuleManifest(
			{
				id: "weather",
				version: "1.0.0",
				dataSchema: z.object({ city: z.string() }),
				actions: {
					refresh: { schema: z.object({}), description: "Reload forecast" },
				},
			},
			{ entry: "./index.js" },
		);

		expect(manifest.actions?.refresh.description).toBe("Reload forecast");
		expect(manifest.actions?.refresh.schema.type).toBe("object");
	});

	test("produces a manifest that passes validateCapsuleManifest", () => {
		const manifest = buildCapsuleManifest(
			{
				id: "weather",
				version: "1.0.0",
				title: "Weather",
				description: "Shows the current weather",
				dataSchema: z.object({ city: z.string() }),
				actions: { refresh: z.object({}) },
				fallback: { text: "{city}" },
			},
			{ entry: "./index.js" },
		);

		const result = validateCapsuleManifest(manifest);
		expect(result.ok).toBe(true);
		expect(result.issues).toHaveLength(0);
	});

	test("reads __capsule static from a capsule module built via defineCapsule", () => {
		const Capsule = defineCapsule({
			id: "weather",
			version: "1.0.0",
			dataSchema: z.object({ city: z.string() }),
			actions: { refresh: z.object({}) },
			render: () => null,
		});

		const manifest = buildCapsuleManifest(Capsule, { entry: "./index.js" });
		expect(manifest.id).toBe("weather");
		expect(manifest.actions?.refresh.schema).toBeDefined();
	});
});
