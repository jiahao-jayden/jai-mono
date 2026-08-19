import { describe, expect, test } from "bun:test";
import * as sdk from "../../src/tools";

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

	test("UpdateTodos replaces the complete session checklist", async () => {
		const replaced: sdk.SessionTodoItem[][] = [];
		const tool = sdk.createUpdateTodosTool(async (items) => {
			replaced.push([...items]);
			return { version: 1, updatedAt: 1_786_017_600_000, items };
		});
		const todos = [
			{ id: "inspect", content: "Inspect session storage", status: "completed" as const },
			{ id: "render", content: "Render Todo progress", status: "in_progress" as const },
		];

		const result = await tool.execute("todos-1", { todos });

		expect(tool).toMatchObject({ name: "UpdateTodos", executionMode: "sequential" });
		expect(replaced).toEqual([todos]);
		expect(result).toEqual({
			content: [{ type: "text", text: "Todo list updated." }],
			details: { todos: { version: 1, updatedAt: 1_786_017_600_000, items: todos } },
		});
	});

	test("UpdateTodos rejects duplicate IDs before replacing state", async () => {
		let replacements = 0;
		const tool = sdk.createUpdateTodosTool(async (items) => {
			replacements++;
			return { version: 1, updatedAt: 0, items };
		});

		await expect(
			tool.execute("todos-duplicate", {
				todos: [
					{ id: "same", content: "First", status: "completed" },
					{ id: "same", content: "Second", status: "pending" },
				],
			}),
		).rejects.toMatchObject({ _tag: "coding_todo.duplicate_id", data: { id: "same" } });
		expect(replacements).toBe(0);
	});

	test("UpdateTodos rejects more than one in-progress item", async () => {
		const tool = sdk.createUpdateTodosTool(async (items) => ({ version: 1, updatedAt: 0, items }));

		await expect(
			tool.execute("todos-concurrent", {
				todos: [
					{ id: "first", content: "First", status: "in_progress" },
					{ id: "second", content: "Second", status: "in_progress" },
				],
			}),
		).rejects.toMatchObject({ _tag: "coding_todo.too_many_in_progress" });
	});

	test("UpdateTodos trims content and rejects whitespace-only items", async () => {
		const replaced: sdk.SessionTodoItem[][] = [];
		const tool = sdk.createUpdateTodosTool(async (items) => {
			replaced.push([...items]);
			return { version: 1, updatedAt: 0, items };
		});

		await tool.execute("todos-trim", {
			todos: [{ id: "inspect", content: "  Inspect storage  ", status: "in_progress" }],
		});
		expect(replaced[0]?.[0]?.content).toBe("Inspect storage");
		await expect(
			tool.execute("todos-empty", {
				todos: [{ id: "empty", content: "   ", status: "pending" }],
			}),
		).rejects.toMatchObject({ _tag: "coding_todo.invalid_content", data: { id: "empty" } });
		expect(replaced).toHaveLength(1);
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
