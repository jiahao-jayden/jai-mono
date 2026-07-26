import { describe, expect, test } from "bun:test";
import { promptTemplate } from "../../src/harness";

describe("promptTemplate", () => {
	test("joins prepared parts with a blank line", () => {
		expect(promptTemplate("You are helpful.", "cwd: /workspace", "Be concise.")).toBe(
			"You are helpful.\n\ncwd: /workspace\n\nBe concise.",
		);
	});

	test("omits undefined and empty optional parts", () => {
		expect(promptTemplate("You are helpful.", undefined, "", "Be concise.")).toBe(
			"You are helpful.\n\nBe concise.",
		);
	});

	test("returns an empty string when no parts are given", () => {
		expect(promptTemplate()).toBe("");
	});
});
