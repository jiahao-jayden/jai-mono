import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGrepTool } from "../../src/tools/grep";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jai-grep-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("grep tool", () => {
	test("searches with line numbers and include filters", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "a.ts"), "first\nconst value = 1;\nlast");
		await writeFile(join(cwd, "a.txt"), "const ignored = true;");
		const tool = createGrepTool({ cwd });

		const result = await tool.execute("grep-1", {
			pattern: "const",
			include: "*.ts",
		});

		expect(result.content[0]).toEqual({
			type: "text",
			text: "a.ts:2: const value = 1;",
		});
		expect(result.details).toMatchObject({ matches: 1, truncated: false });
	});

	test("treats leading dashes as a literal pattern when requested", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "--help");
		const tool = createGrepTool({ cwd });

		const result = await tool.execute("grep-1", {
			pattern: "--help",
			literal: true,
		});

		expect(result.content[0]).toEqual({
			type: "text",
			text: "file.txt:1: --help",
		});
	});

	test("keeps trailing context for the final limited match", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "before\nneedle\nafter\nneedle");
		const tool = createGrepTool({ cwd });

		const result = await tool.execute("grep-1", {
			pattern: "needle",
			context: 1,
			limit: 1,
		});

		expect(result.content[0]).toEqual({
			type: "text",
			text: "file.txt-1- before\nfile.txt:2: needle\nfile.txt-3- after\n\n[Match limit 1 reached. Refine the pattern or increase limit.]",
		});
	});

	test("bounds matching lines before parsing ripgrep output", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "long.txt"), `needle${"x".repeat(1024 * 1024)}`);
		const tool = createGrepTool({ cwd });

		const result = await tool.execute("grep-1", { pattern: "needle" });

		expect((result.content[0] as { text: string }).text.length).toBeLessThan(3_000);
	});
});
