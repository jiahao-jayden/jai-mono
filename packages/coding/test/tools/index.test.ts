import { describe, expect, test } from "bun:test";
import * as sdk from "../../src";

describe("createCodingTools", () => {
	test("returns the stable built-in tool set", () => {
		const tools = sdk.createCodingTools({ cwd: process.cwd() });

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
		expect("allowOutsideWorkspace" in sdk).toBe(false);
		expect("createReadTool" in sdk).toBe(false);
		expect("createBashTool" in sdk).toBe(false);
	});

	test("maps shell, timeout, and ripgrep options into the Node environment", async () => {
		const missing = `${process.cwd()}/definitely-missing`;
		const shellTools = sdk.createCodingTools({ cwd: process.cwd(), shell: missing });
		await expect(shellTools[5]!.execute("bash-1", { command: "true" })).rejects.toThrow("Shell not found");

		const timeoutTools = sdk.createCodingTools({ cwd: process.cwd(), timeoutMs: 10 });
		await expect(timeoutTools[5]!.execute("bash-2", { command: "sleep 1" })).rejects.toThrow(
			"Command timed out",
		);

		const searchTools = sdk.createCodingTools({ cwd: process.cwd(), ripgrepPath: missing });
		await expect(searchTools[1]!.execute("glob-1", { pattern: "*" })).rejects.toThrow(
			"ripgrep (rg) is required",
		);
	});
});
