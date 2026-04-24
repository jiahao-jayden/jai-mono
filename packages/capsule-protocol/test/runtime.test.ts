// Bun has no `window`, so these only cover the library-import branch.
// Sandbox auto-mount is covered by app/desktop integration tests.

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import {
	defineCapsule,
	getBootstrap,
} from "../src/runtime";

describe("defineCapsule (library mode)", () => {
	test("returns the component unchanged when no sandbox bootstrap is present", () => {
		function Inner() {
			return createElement("div");
		}
		const Wrapped = defineCapsule(Inner);
		expect(Wrapped).toBe(Inner);
	});

	test("does not throw in a non-browser environment", () => {
		expect(() => defineCapsule(() => null)).not.toThrow();
	});

	test("getBootstrap returns undefined without a window", () => {
		expect(getBootstrap()).toBeUndefined();
	});
});
