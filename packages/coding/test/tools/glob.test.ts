import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGlobTool } from "../../src/tools/glob";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jai-glob-"));
	temporaryDirectories.push(directory);
	await mkdir(join(directory, ".git"));
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("glob tool", () => {
	test("finds stable relative paths while respecting gitignore", async () => {
		const cwd = await createWorkspace();
		await mkdir(join(cwd, "src"));
		await mkdir(join(cwd, "ignored"));
		await writeFile(join(cwd, ".gitignore"), "ignored/\n");
		await writeFile(join(cwd, "src", "b.ts"), "");
		await writeFile(join(cwd, "src", "a.ts"), "");
		await writeFile(join(cwd, "ignored", "hidden.ts"), "");
		const tool = createGlobTool({ cwd });

		const result = await tool.execute("glob-1", { pattern: "**/*.ts" });

		expect(result.content[0]).toEqual({
			type: "text",
			text: "src/a.ts\nsrc/b.ts",
		});
		expect(result.details).toMatchObject({ count: 2, truncated: false });
	});

	test("returns a normal empty result", async () => {
		const cwd = await createWorkspace();
		const tool = createGlobTool({ cwd });

		const result = await tool.execute("glob-1", { pattern: "*.missing" });

		expect(result.content[0]).toEqual({ type: "text", text: "No files found" });
	});
});
