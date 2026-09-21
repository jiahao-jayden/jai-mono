import { describe, expect, test } from "bun:test";
import { NodeExecutionEnvironment } from "@jai/agent/node/environment";
import * as sdk from "../../src/tools";

const environment = (shell?: string) => new NodeExecutionEnvironment({ cwd: process.cwd(), ...(shell ? { shellPath: shell } : {}) });

describe("createCodingTools", () => {
	test("returns the stable built-in tool set", () => {
		const tools = sdk.createCodingTools({ cwd: process.cwd() }, environment());

		expect(tools.map((tool) => tool.name)).toEqual(["Read", "Bash", "Edit", "Write"]);
		expect(tools.map((tool) => tool.executionMode)).toEqual([
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

	test("maps shell and timeout options into the Node environment", async () => {
		const missing = `${process.cwd()}/definitely-missing`;
		const shellTools = sdk.createCodingTools({ cwd: process.cwd(), shell: missing }, environment(missing));
		await expect(shellTools[1]!.execute("bash-1", { command: "true" })).rejects.toThrow("Shell not found");

		const timeoutTools = sdk.createCodingTools({ cwd: process.cwd(), timeoutMs: 10 }, environment());
		await expect(timeoutTools[1]!.execute("bash-2", { command: "sleep 1" })).rejects.toThrow(
			"Command timed out",
		);

	});
});
