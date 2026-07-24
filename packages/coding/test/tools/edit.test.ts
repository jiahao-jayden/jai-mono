import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditTool } from "../../src/tools/edit";

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jai-edit-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("edit tool", () => {
	test("applies multiple replacements against the original file", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "alpha\nmiddle\nomega");
		const tool = createEditTool({ cwd });

		const result = await tool.execute("edit-1", {
			path: "file.txt",
			edits: [
				{ oldText: "alpha", newText: "first" },
				{ oldText: "omega", newText: "last" },
			],
		});

		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("first\nmiddle\nlast");
		expect(result.details).toMatchObject({ replacements: 2, firstChangedLine: 1 });
	});

	test("preserves UTF-8 BOM and CRLF line endings", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "\uFEFFone\r\ntwo\r\n");
		const tool = createEditTool({ cwd });

		await tool.execute("edit-1", {
			path: "file.txt",
			edits: [{ oldText: "one\ntwo", newText: "first\nsecond" }],
		});

		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("\uFEFFfirst\r\nsecond\r\n");
	});

	test("does not normalize untouched mixed line endings", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "one\r\ntwo\nthree");
		const tool = createEditTool({ cwd });

		await tool.execute("edit-1", {
			path: "file.txt",
			edits: [{ oldText: "one\ntwo", newText: "first\nsecond" }],
		});

		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("first\r\nsecond\nthree");
	});

	test("rejects missing and ambiguous replacements without modifying the file", async () => {
		const cwd = await createWorkspace();
		const path = join(cwd, "file.txt");
		await writeFile(path, "same\nsame");
		const tool = createEditTool({ cwd });

		await expect(
			tool.execute("edit-1", {
				path: "file.txt",
				edits: [{ oldText: "same", newText: "changed" }],
			}),
		).rejects.toThrow("multiple matches");
		await expect(
			tool.execute("edit-2", {
				path: "file.txt",
				edits: [{ oldText: "missing", newText: "changed" }],
			}),
		).rejects.toThrow("Could not find");
		expect(await readFile(path, "utf8")).toBe("same\nsame");
	});
});
