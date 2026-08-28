import { describe, expect, test } from "bun:test";
import { resolveCodingToolSelection } from "../src/sdk/tool-selection";

describe("public built-in tool selection", () => {
	test("defaults to the Pi-style core tools, then applies explicit selection and exclusion", () => {
		expect([...resolveCodingToolSelection(undefined, undefined)]).toEqual([
			"Read",
			"Bash",
			"Edit",
			"Write",
		]);
		expect([...resolveCodingToolSelection(["Read", "Write", "Bash"], ["Write"])]).toEqual(["Read", "Bash"]);
	});

	test("rejects a runtime value outside the public tool union", () => {
		for (const name of ["Glob", "Grep", "NotATool"]) {
			expect(() => resolveCodingToolSelection([name as "Read"], undefined)).toThrow(
				`Unknown built-in tool "${name}" in tools`,
			);
		}
	});
});
