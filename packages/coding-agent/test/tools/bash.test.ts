import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "../../src/tools/bash.js";

const TMP = join(tmpdir(), `jai-test-bash-${Date.now()}`);

beforeEach(() => {
	mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("Bash validate", () => {
	const tool = bashTool(TMP);

	test("rejects empty command", () => {
		expect(tool.validate?.({ description: "say hello", command: "", timeout: 30000 })).toContain("empty");
	});

	test("rejects missing description", () => {
		expect(tool.validate?.({ description: "", command: "echo hi", timeout: 30000 })).toContain("description");
	});

	test("blocks rm -rf /", () => {
		expect(tool.validate?.({ description: "wipe root", command: "rm -rf /", timeout: 30000 })).toContain("blocked");
	});

	test("blocks fork bomb", () => {
		expect(tool.validate?.({ description: "fork bomb", command: ":(){ :|:& };:", timeout: 30000 })).toContain(
			"blocked",
		);
	});

	test("accepts normal commands", () => {
		expect(tool.validate?.({ description: "say hi", command: "echo hello", timeout: 30000 })).toBeUndefined();
		expect(tool.validate?.({ description: "list", command: "ls -la", timeout: 30000 })).toBeUndefined();
	});
});

describe("Bash execute", () => {
	const tool = bashTool(TMP);

	test("runs a simple command", async () => {
		const result = await tool.execute({ description: "say hello", command: "echo hello", timeout: 30000 });
		const text = (result as any).content[0].text;
		expect(text).toContain("hello");
		expect((result as any).isError).toBeUndefined();
	});

	test("returns error on non-zero exit code", async () => {
		const result = await tool.execute({ description: "exit 1", command: "exit 1", timeout: 30000 });
		expect((result as any).isError).toBe(true);
		expect((result as any).content[0].text).toContain("Exit code: 1");
	});

	test("uses specified cwd", async () => {
		const result = await tool.execute({
			description: "print working dir",
			command: "pwd",
			timeout: 30000,
			cwd: "/tmp",
		});
		const text = (result as any).content[0].text;
		// /tmp may resolve to /private/tmp on macOS
		expect(text).toMatch(/\/?tmp/);
	});

	test("handles timeout", async () => {
		const result = await tool.execute({ description: "long sleep", command: "sleep 10", timeout: 1000 });
		expect((result as any).isError).toBe(true);
		expect((result as any).content[0].text).toContain("timed out");
	}, 10_000);

	test("merges stderr into output", async () => {
		const result = await tool.execute({ description: "stderr echo", command: "echo err >&2", timeout: 30000 });
		const text = (result as any).content[0].text;
		expect(text).toContain("err");
	});
});
