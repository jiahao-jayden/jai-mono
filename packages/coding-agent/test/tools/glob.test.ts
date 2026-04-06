import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globTool } from "../../src/tools/glob.js";

const TMP = join(tmpdir(), `jai-test-glob-${Date.now()}`);

beforeEach(() => {
	mkdirSync(join(TMP, "src", "utils"), { recursive: true });
	writeFileSync(join(TMP, "src", "index.ts"), "");
	writeFileSync(join(TMP, "src", "app.ts"), "");
	writeFileSync(join(TMP, "src", "utils", "helpers.ts"), "");
	writeFileSync(join(TMP, "README.md"), "");
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("Glob validate", () => {
	const tool = globTool(TMP);

	test("rejects empty pattern", () => {
		expect(tool.validate?.({ pattern: "" })).toContain("empty");
	});

	test("rejects pattern without wildcards", () => {
		expect(tool.validate?.({ pattern: "src/index.ts" })).toContain("FileRead");
	});

	test("accepts valid pattern", () => {
		expect(tool.validate?.({ pattern: "**/*.ts" })).toBeUndefined();
	});
});

describe("Glob execute", () => {
	const tool = globTool(TMP);

	test("finds files matching pattern", async () => {
		const result = await tool.execute({ pattern: "**/*.ts" });
		const text = (result as any).content[0].text;
		expect(text).toContain("3 files");
		expect(text).toContain("index.ts");
		expect(text).toContain("helpers.ts");
	});

	test("returns 0 results message", async () => {
		const result = await tool.execute({ pattern: "**/*.xyz" });
		const text = (result as any).content[0].text;
		expect(text).toContain("No files found");
	});

	test("respects cwd override", async () => {
		const result = await tool.execute({ pattern: "*.ts", cwd: join(TMP, "src") });
		const text = (result as any).content[0].text;
		expect(text).toContain("index.ts");
		expect(text).toContain("app.ts");
	});
});
