import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaggedError } from "better-result";
import { createEditTool } from "../../../src";
import { MAX_EDIT_FILE_BYTES } from "../../../src/harness/tools/edit";
import { createNodeToolOptions } from "./support";

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
	test("allows files below and exactly at the Edit size boundary", async () => {
		for (const size of [MAX_EDIT_FILE_BYTES - 1, MAX_EDIT_FILE_BYTES]) {
			const cwd = await createWorkspace();
			await writeFile(join(cwd, "file.txt"), "before");
			const options = createNodeToolOptions(cwd);
			const originalStat = options.environment.stat.bind(options.environment);
			options.environment.stat = async (path, statOptions) => ({
				...(await originalStat(path, statOptions)),
				size,
			});
			const tool = createEditTool(options.workspace);

			await tool.execute(`edit-${size}`, {
				path: "file.txt",
				edits: [{ oldText: "before", newText: "after" }],
			});

			expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("after");
		}
	});

	test("rejects an oversized file before reading its contents", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "before");
		const options = createNodeToolOptions(cwd);
		let readCalls = 0;
		options.environment.stat = async () => ({ kind: "file", size: MAX_EDIT_FILE_BYTES + 1, mtimeMs: 1 });
		options.environment.readFile = async () => {
			readCalls++;
			return new Uint8Array();
		};
		const tool = createEditTool(options.workspace);

		await expect(
			tool.execute("edit-large", {
				path: "file.txt",
				edits: [{ oldText: "before", newText: "after" }],
			}),
		).rejects.toMatchObject({
			_tag: "tool.edit.file_too_large",
			actualBytes: MAX_EDIT_FILE_BYTES + 1,
			maxBytes: MAX_EDIT_FILE_BYTES,
		});
		expect(readCalls).toBe(0);
	});

	test("preserves filesystem stat failures without reading the file", async () => {
		class StatFailed extends TaggedError("filesystem.stat_failed")<{ readonly message: string }> {}
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "before");
		const options = createNodeToolOptions(cwd);
		const failure = new StatFailed({ message: "stat failed" });
		let readCalls = 0;
		options.environment.stat = async () => {
			throw failure;
		};
		options.environment.readFile = async () => {
			readCalls++;
			return new Uint8Array();
		};
		const tool = createEditTool(options.workspace);

		try {
			await tool.execute("edit-stat", {
				path: "file.txt",
				edits: [{ oldText: "before", newText: "after" }],
			});
			expect.unreachable("Edit should preserve the stat failure");
		} catch (error) {
			expect(error).toBe(failure);
		}
		expect(readCalls).toBe(0);
	});

	test("applies multiple replacements against the original file", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "alpha\nmiddle\nomega");
		const tool = createEditTool(createNodeToolOptions(cwd).workspace);

		const result = await tool.execute("edit-1", {
			path: "file.txt",
			edits: [
				{ oldText: "alpha", newText: "first" },
				{ oldText: "omega", newText: "last" },
			],
		});

		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("first\nmiddle\nlast");
		expect(result.details).toMatchObject({ replacements: 2, firstChangedLine: 1 });
		expect(result.fileChanges).toEqual([{ operation: "modify", path: await realpath(join(cwd, "file.txt")) }]);
	});

	test("preserves UTF-8 BOM and CRLF line endings", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "\uFEFFone\r\ntwo\r\n");
		const tool = createEditTool(createNodeToolOptions(cwd).workspace);

		await tool.execute("edit-1", {
			path: "file.txt",
			edits: [{ oldText: "one\ntwo", newText: "first\nsecond" }],
		});

		expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("\uFEFFfirst\r\nsecond\r\n");
	});

	test("does not normalize untouched mixed line endings", async () => {
		const cwd = await createWorkspace();
		await writeFile(join(cwd, "file.txt"), "one\r\ntwo\nthree");
		const tool = createEditTool(createNodeToolOptions(cwd).workspace);

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
		const tool = createEditTool(createNodeToolOptions(cwd).workspace);

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
		).rejects.toThrow("Re-read the file and retry with text copied exactly from its current contents.");
		expect(await readFile(path, "utf8")).toBe("same\nsame");
	});
});
