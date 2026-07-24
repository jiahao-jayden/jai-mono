import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteTool } from "../../src/tools/write";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jai-write-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("write tool", () => {
	test("creates parent directories and atomically overwrites files", async () => {
		const cwd = await createWorkspace();
		const tool = createWriteTool({ cwd });

		const created = await tool.execute("write-1", {
			path: "src/file.txt",
			content: "first",
		});
		const overwritten = await tool.execute("write-2", {
			path: "src/file.txt",
			content: "second",
		});

		expect(await readFile(join(cwd, "src", "file.txt"), "utf8")).toBe("second");
		expect(created.details?.created).toBe(true);
		expect(overwritten.details?.created).toBe(false);
	});

	test("does not modify a file when already aborted", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "original");
		const tool = createWriteTool({ cwd });
		const controller = new AbortController();
		controller.abort();

		await expect(
			tool.execute("write-1", { path: "file.txt", content: "changed" }, controller.signal),
		).rejects.toThrow("Operation aborted");
		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("original");
	});
});
