import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileReadTool } from "../../src/tools/file-read.js";

const TMP = join(tmpdir(), `jai-test-file-read-${Date.now()}`);

beforeEach(() => {
	mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("FileRead validate", () => {
	test("rejects empty path", () => {
		expect(fileReadTool.validate?.({ path: "", offset: 0, limit: 200 })).toContain("empty");
	});

	test("rejects binary extensions", () => {
		expect(fileReadTool.validate?.({ path: "photo.jpg", offset: 0, limit: 200 })).toContain("Binary");
		expect(fileReadTool.validate?.({ path: "archive.zip", offset: 0, limit: 200 })).toContain("Binary");
		expect(fileReadTool.validate?.({ path: "program.exe", offset: 0, limit: 200 })).toContain("Binary");
	});

	test("accepts text files", () => {
		expect(fileReadTool.validate?.({ path: "code.ts", offset: 0, limit: 200 })).toBeUndefined();
		expect(fileReadTool.validate?.({ path: "readme.md", offset: 0, limit: 200 })).toBeUndefined();
	});
});

describe("FileRead execute", () => {
	test("reads a small file", async () => {
		const filePath = join(TMP, "small.txt");
		writeFileSync(filePath, "line1\nline2\nline3");

		const result = await fileReadTool.execute({ path: filePath, offset: 0, limit: 200 });
		const text = (result as any).content[0].text;
		expect(text).toContain("lines 1–3 of 3");
		expect(text).toContain("line1");
		expect(text).toContain("line3");
		expect(text).not.toContain("more lines");
	});

	test("handles offset and limit", async () => {
		const filePath = join(TMP, "paged.txt");
		const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`);
		writeFileSync(filePath, lines.join("\n"));

		const result = await fileReadTool.execute({ path: filePath, offset: 5, limit: 3 });
		const text = (result as any).content[0].text;
		expect(text).toContain("lines 6–8 of 20");
		expect(text).toContain("line-6");
		expect(text).toContain("line-8");
		expect(text).toContain("12 more lines");
	});

	test("returns error for missing file", async () => {
		const result = await fileReadTool.execute({ path: join(TMP, "nope.txt"), offset: 0, limit: 200 });
		expect((result as any).isError).toBe(true);
		expect((result as any).content[0].text).toContain("File not found");
	});

	test("truncation hint when file exceeds limit", async () => {
		const filePath = join(TMP, "big.txt");
		const lines = Array.from({ length: 300 }, (_, i) => `row-${i}`);
		writeFileSync(filePath, lines.join("\n"));

		const result = await fileReadTool.execute({ path: filePath, offset: 0, limit: 200 });
		const text = (result as any).content[0].text;
		expect(text).toContain("lines 1–200 of 300");
		expect(text).toContain("Use offset=200 to continue");
	});
});
