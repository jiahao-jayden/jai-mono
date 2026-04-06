import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileWriteTool } from "../../src/tools/file-write.js";

const TMP = join(tmpdir(), `jai-test-file-write-${Date.now()}`);

beforeEach(() => {
	mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("FileWrite validate", () => {
	test("rejects empty path", () => {
		expect(fileWriteTool.validate?.({ path: "", content: "hello" })).toContain("empty");
	});

	test("rejects content over 10MB", () => {
		const big = "x".repeat(11 * 1024 * 1024);
		expect(fileWriteTool.validate?.({ path: "file.txt", content: big })).toContain("10MB");
	});

	test("accepts valid input", () => {
		expect(fileWriteTool.validate?.({ path: "file.txt", content: "hello" })).toBeUndefined();
	});
});

describe("FileWrite execute", () => {
	test("writes a new file", async () => {
		const filePath = join(TMP, "new.txt");
		const result = await fileWriteTool.execute({ path: filePath, content: "hello world" });
		const text = (result as any).content[0].text;
		expect(text).toContain("Written");
		expect(text).toContain("bytes");
		expect(readFileSync(filePath, "utf8")).toBe("hello world");
	});

	test("creates parent directories", async () => {
		const filePath = join(TMP, "a", "b", "c", "deep.txt");
		const result = await fileWriteTool.execute({ path: filePath, content: "deep" });
		const text = (result as any).content[0].text;
		expect(text).toContain("Created directory");
		expect(existsSync(filePath)).toBe(true);
	});

	test("overwrites existing file", async () => {
		const filePath = join(TMP, "overwrite.txt");
		await fileWriteTool.execute({ path: filePath, content: "first" });
		await fileWriteTool.execute({ path: filePath, content: "second" });
		expect(readFileSync(filePath, "utf8")).toBe("second");
	});
});
