import { describe, expect, test } from "bun:test";
import { createHarnessTools } from "../../../src";
import * as sdk from "../../../src";
import { createNodeToolOptions } from "./support";

describe("createHarnessTools", () => {
	test("returns the stable built-in tool set", () => {
		const { environment } = createNodeToolOptions(process.cwd());
		const tools = createHarnessTools({ environment, workspaceRoot: process.cwd() });

		expect(tools.map((tool) => tool.name)).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "Bash"]);
		expect(tools.map((tool) => tool.executionMode)).toEqual([
			"parallel",
			"parallel",
			"parallel",
			"sequential",
			"sequential",
			"sequential",
		]);
	});

	test("does not expose internal infrastructure", () => {
		expect("resolveWorkspacePath" in sdk).toBe(false);
		expect("truncateText" in sdk).toBe(false);
	});
});
