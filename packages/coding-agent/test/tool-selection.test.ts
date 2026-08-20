import { describe, expect, test } from "bun:test";
import { resolveCodingToolSelection } from "../src/sdk/tool-selection";

describe("public built-in tool selection", () => {
	test("defaults to all tools, then applies explicit selection and exclusion", () => {
		expect([...resolveCodingToolSelection(undefined, undefined)]).toEqual([
			"Read",
			"Write",
			"Edit",
			"Glob",
			"Grep",
			"Bash",
			"Skill",
			"UpdateTodos",
			"SpawnAgent",
		]);
		expect([...resolveCodingToolSelection(["Read", "Write", "Bash"], ["Write"])]).toEqual(["Read", "Bash"]);
	});

	test("rejects a runtime value outside the public tool union", () => {
		expect(() => resolveCodingToolSelection(["NotATool" as "Read"], undefined)).toThrow(
			'Unknown built-in tool "NotATool" in tools',
		);
	});
});
