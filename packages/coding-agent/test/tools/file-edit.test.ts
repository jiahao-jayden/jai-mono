import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileEditTool } from "../../src/tools/file-edit.js";

const TMP = join(tmpdir(), `jai-test-file-edit-${Date.now()}`);

beforeEach(() => {
	mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("FileEdit validate", () => {
	test("rejects empty path", () => {
		expect(fileEditTool.validate?.({ path: "", old_string: "a", new_string: "b", replace_all: false })).toContain(
			"empty",
		);
	});

	test("rejects empty old_string", () => {
		expect(fileEditTool.validate?.({ path: "f.ts", old_string: "", new_string: "b", replace_all: false })).toContain(
			"empty",
		);
	});

	test("rejects identical old and new", () => {
		expect(
			fileEditTool.validate?.({ path: "f.ts", old_string: "same", new_string: "same", replace_all: false }),
		).toContain("identical");
	});

	test("accepts valid input", () => {
		expect(
			fileEditTool.validate?.({ path: "f.ts", old_string: "a", new_string: "b", replace_all: false }),
		).toBeUndefined();
	});
});

describe("FileEdit execute", () => {
	test("replaces single occurrence", async () => {
		const filePath = join(TMP, "edit.txt");
		writeFileSync(filePath, "hello world\ngoodbye world");

		const result = await fileEditTool.execute({
			path: filePath,
			old_string: "hello",
			new_string: "hi",
			replace_all: false,
		});
		const text = (result as any).content[0].text;
		expect(text).toContain("Replaced 1 occurrence");
		expect(readFileSync(filePath, "utf8")).toBe("hi world\ngoodbye world");
	});

	test("replace_all replaces all occurrences", async () => {
		const filePath = join(TMP, "edit-all.txt");
		writeFileSync(filePath, "foo bar foo baz foo");

		const result = await fileEditTool.execute({
			path: filePath,
			old_string: "foo",
			new_string: "qux",
			replace_all: true,
		});
		const text = (result as any).content[0].text;
		expect(text).toContain("Replaced 3 occurrences");
		expect(readFileSync(filePath, "utf8")).toBe("qux bar qux baz qux");
	});

	test("errors when old_string not found, shows file content", async () => {
		const filePath = join(TMP, "no-match.txt");
		writeFileSync(filePath, "actual content here");

		const result = await fileEditTool.execute({
			path: filePath,
			old_string: "nonexistent",
			new_string: "x",
			replace_all: false,
		});
		expect((result as any).isError).toBe(true);
		const text = (result as any).content[0].text;
		expect(text).toContain("not found");
		expect(text).toContain("actual content here");
	});

	test("errors when multiple matches and replace_all=false", async () => {
		const filePath = join(TMP, "multi.txt");
		writeFileSync(filePath, "dup\ndup\ndup");

		const result = await fileEditTool.execute({
			path: filePath,
			old_string: "dup",
			new_string: "x",
			replace_all: false,
		});
		expect((result as any).isError).toBe(true);
		const text = (result as any).content[0].text;
		expect(text).toContain("matches 3 locations");
	});

	test("errors for missing file", async () => {
		const result = await fileEditTool.execute({
			path: join(TMP, "nope.txt"),
			old_string: "a",
			new_string: "b",
			replace_all: false,
		});
		expect((result as any).isError).toBe(true);
		expect((result as any).content[0].text).toContain("File not found");
	});
});
