import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBashTool } from "../../src/tools/bash";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jai-bash-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("bash tool", () => {
	test("runs in the workspace and returns stdout", async () => {
		const cwd = await createWorkspace();
		const tool = createBashTool({ cwd });

		const result = await tool.execute("bash-1", { command: "printf '%s' \"$PWD\"" });

		expect(result.content[0]).toEqual({ type: "text", text: await realpath(cwd) });
		expect(result.details?.exitCode).toBe(0);
	});

	test("includes output in non-zero exit errors", async () => {
		const cwd = await createWorkspace();
		const tool = createBashTool({ cwd });

		await expect(tool.execute("bash-1", { command: "printf 'failure'; exit 3" })).rejects.toThrow(
			"Command exited with code 3",
		);
	});

	test("supports timeout and abort", async () => {
		const cwd = await createWorkspace();
		const tool = createBashTool({ cwd });

		await expect(tool.execute("bash-1", { command: "sleep 2", timeoutMs: 20 })).rejects.toThrow("Command timed out");

		const controller = new AbortController();
		let markUpdateReceived = () => {};
		const updateReceived = new Promise<void>((resolve) => {
			markUpdateReceived = resolve;
		});
		const run = tool.execute("bash-2", { command: "printf 'started'; sleep 2" }, controller.signal, () =>
			markUpdateReceived(),
		);
		await updateReceived;
		controller.abort();
		await expect(run).rejects.toThrow("Command aborted");
	});

	test("keeps full output in a temporary file when truncated", async () => {
		const cwd = await createWorkspace();
		const tool = createBashTool({ cwd });

		const result = await tool.execute("bash-1", {
			command: "i=1; while [ $i -le 20000 ]; do echo $i; i=$((i + 1)); done",
		});
		const fullOutputPath = result.details?.fullOutputPath;

		expect(result.details?.truncation?.truncated).toBe(true);
		expect(fullOutputPath).toBeDefined();
		await access(fullOutputPath!);
		await rm(fullOutputPath!, { force: true });
	});
});
