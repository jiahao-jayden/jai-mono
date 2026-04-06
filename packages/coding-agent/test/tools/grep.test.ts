import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grepTool } from "../../src/tools/grep.js";

const TMP = join(tmpdir(), `jai-test-grep-${Date.now()}`);

beforeEach(() => {
	mkdirSync(join(TMP, "src"), { recursive: true });
	writeFileSync(join(TMP, "src", "a.ts"), "function hello() {\n  return 'hello';\n}\n");
	writeFileSync(join(TMP, "src", "b.ts"), "const x = 42;\nconst hello = 'world';\n");
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("Grep validate", () => {
	test("rejects empty pattern", () => {
		expect(
			grepTool.validate?.({ pattern: "", path: TMP, recursive: true, case_sensitive: false, offset: 0, limit: 50 }),
		).toContain("empty");
	});

	test("rejects empty path", () => {
		expect(
			grepTool.validate?.({
				pattern: "hello",
				path: "",
				recursive: true,
				case_sensitive: false,
				offset: 0,
				limit: 50,
			}),
		).toContain("empty");
	});

	test("accepts valid input", () => {
		expect(
			grepTool.validate?.({
				pattern: "hello",
				path: TMP,
				recursive: true,
				case_sensitive: false,
				offset: 0,
				limit: 50,
			}),
		).toBeUndefined();
	});
});

describe("Grep execute", () => {
	test("finds matches across files", async () => {
		const result = await grepTool.execute({
			pattern: "hello",
			path: TMP,
			recursive: true,
			case_sensitive: false,
			offset: 0,
			limit: 50,
		});
		const text = (result as any).content[0].text;
		expect(text).toContain("hello");
		expect(text).toMatch(/\d+ match/);
	});

	test("returns no matches message", async () => {
		const result = await grepTool.execute({
			pattern: "zzzznotfound",
			path: TMP,
			recursive: true,
			case_sensitive: false,
			offset: 0,
			limit: 50,
		});
		const text = (result as any).content[0].text;
		expect(text).toContain("No matches");
	});

	test("respects case sensitivity", async () => {
		const result = await grepTool.execute({
			pattern: "HELLO",
			path: TMP,
			recursive: true,
			case_sensitive: true,
			offset: 0,
			limit: 50,
		});
		const text = (result as any).content[0].text;
		expect(text).toContain("No matches");
	});
});
