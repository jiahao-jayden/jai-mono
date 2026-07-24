import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadTool } from "../../src/tools/read";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jai-read-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("read tool", () => {
	test("reads numbered pages and reports the next offset", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "one\ntwo\nthree");
		const tool = createReadTool({ cwd });

		const result = await tool.execute("read-1", { path: "file.txt", offset: 2, limit: 1 });

		expect(result.content[0]).toEqual({
			type: "text",
			text: "2|two\n\n[Showing lines 2-2 of 3. Use offset=3 to continue.]",
		});
		expect(result.details?.nextOffset).toBe(3);
	});

	test("rejects binary files and aborted calls", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "binary"), Buffer.from([0, 1, 2]));
		const tool = createReadTool({ cwd });

		await expect(tool.execute("read-1", { path: "binary" })).rejects.toThrow("binary file");

		const controller = new AbortController();
		controller.abort();
		await expect(tool.execute("read-2", { path: "binary" }, controller.signal)).rejects.toThrow("Operation aborted");
	});

	test("bounds very long lines and validates offsets for empty files", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "long.txt"), "x".repeat(1024 * 1024));
		await writeFile(join(cwd, "empty.txt"), "");
		const tool = createReadTool({ cwd });

		const result = await tool.execute("read-1", { path: "long.txt" });

		expect((result.content[0] as { text: string }).text.length).toBeLessThan(3_000);
		expect(result.details?.truncation?.truncated).toBe(true);
		await expect(tool.execute("read-2", { path: "empty.txt", offset: 2 })).rejects.toThrow("beyond end of file");
	});
});
