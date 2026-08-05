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
		expect([
			tools[0]?.title?.({ path: "README.md" }),
			tools[1]?.title?.({ pattern: "**/*.ts" }),
			tools[2]?.title?.({ pattern: "AgentTool" }),
			tools[3]?.title?.({ path: "result.md", content: "" }),
			tools[4]?.title?.({ path: "result.md", edits: [] }),
			tools[5]?.title?.({ command: "bun test" }),
		]).toEqual([
			"Read README.md",
			"Find **/*.ts",
			"Search AgentTool",
			"Write result.md",
			"Edit result.md",
			"Run bun test",
		]);
	});

	test("does not expose internal infrastructure", () => {
		expect("resolveWorkspacePath" in sdk).toBe(false);
		expect("truncateText" in sdk).toBe(false);
	});
});
