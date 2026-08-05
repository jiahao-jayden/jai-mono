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

	test("ReportProgress is a side-effect-free structured narration tool", async () => {
		const tool = sdk.createReportProgressTool();

		expect(tool).toMatchObject({ name: "ReportProgress", executionMode: "parallel" });
		expect(tool.title?.({ title: "Inspecting storage", detail: "Reading session files." })).toBe(
			"Inspecting storage",
		);
		expect(await tool.execute("progress-1", { title: "Inspecting storage", detail: "Reading session files." })).toEqual({
			content: [{ type: "text", text: "Progress reported." }],
		});
	});

	test("SpawnAgent returns only the final text and streams the latest activity", async () => {
		const updates: unknown[] = [];
		const tool = sdk.createSpawnAgentTool(async ({ task, onActivity }) => {
			expect(task).toBe("Inspect the repository.");
			onActivity("Reading repository files");
			return "Inspection complete.";
		});

		const result = await tool.execute(
			"subagent-1",
			{ title: "Inspect repository", task: "Inspect the repository." },
			undefined,
			(partial) => updates.push(partial.details),
		);

		expect(tool).toMatchObject({ name: "SpawnAgent", executionMode: "parallel" });
		expect(tool.title?.({ title: "Inspect repository", task: "Inspect the repository." })).toBe(
			"Inspect repository",
		);
		expect(result).toEqual({
			content: [{ type: "text", text: "Inspection complete." }],
			details: {
				title: "Inspect repository",
				status: "complete",
				activityTitle: "Reading repository files",
			},
		});
		expect(updates).toEqual([
			{ title: "Inspect repository", status: "running" },
			{
				title: "Inspect repository",
				status: "running",
				activityTitle: "Reading repository files",
			},
			{
				title: "Inspect repository",
				status: "complete",
				activityTitle: "Reading repository files",
			},
		]);
	});

	test("SpawnAgent rejects a fifth concurrent child without queueing", async () => {
		const releases: Array<() => void> = [];
		const tool = sdk.createSpawnAgentTool(
			() =>
				new Promise<string>((resolve) => {
					releases.push(() => resolve("done"));
				}),
		);
		const running = Array.from({ length: sdk.MAX_CONCURRENT_SUBAGENTS }, (_, index) =>
			tool.execute(`subagent-${index}`, { title: `Task ${index}`, task: "Wait." }),
		);

		await expect(tool.execute("subagent-overflow", { title: "Overflow", task: "Wait." })).rejects.toMatchObject({
			_tag: "coding_subagent.concurrency_limit",
		});
		for (const release of releases) release();
		await Promise.all(running);
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
