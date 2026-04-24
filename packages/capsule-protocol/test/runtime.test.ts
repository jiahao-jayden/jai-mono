// Bun has no `window`, so these only cover the library-import branch.
// Sandbox auto-mount is covered by app/desktop integration tests.

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { z } from "zod";
import { defineCapsule, getBootstrap } from "../src/runtime";

describe("defineCapsule (library mode)", () => {
	test("returns a React component carrying __capsule metadata", () => {
		const dataSchema = z.object({ city: z.string() });
		const Capsule = defineCapsule({
			id: "weather",
			version: "1.0.0",
			dataSchema,
			render: ({ data }) => createElement("div", null, data.city),
		});

		expect(typeof Capsule).toBe("function");
		expect(Capsule.__capsule.id).toBe("weather");
		expect(Capsule.__capsule.version).toBe("1.0.0");
		expect(Capsule.__capsule.dataSchema).toBe(dataSchema);
	});

	test("__capsule is non-enumerable so JSON serialization of the module is clean", () => {
		const Capsule = defineCapsule({
			id: "x",
			version: "0",
			dataSchema: z.any(),
			render: () => null,
		});
		const descriptor = Object.getOwnPropertyDescriptor(Capsule, "__capsule");
		expect(descriptor?.enumerable).toBe(false);
		expect(descriptor?.writable).toBe(false);
	});

	test("does not throw in a non-browser environment", () => {
		expect(() =>
			defineCapsule({
				id: "x",
				version: "0",
				dataSchema: z.any(),
				render: () => null,
			}),
		).not.toThrow();
	});

	test("getBootstrap returns undefined without a window", () => {
		expect(getBootstrap()).toBeUndefined();
	});
});
