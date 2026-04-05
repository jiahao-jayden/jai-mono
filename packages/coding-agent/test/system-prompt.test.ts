import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../src/core/system-prompt.js";

// ── Section assembly ─────────────────────────────────────────

describe("buildSystemPrompt", () => {
	test("includes STATIC.md content (always present)", async () => {
		const prompt = await buildSystemPrompt({ cwd: "/tmp/test", tools: [] });
		expect(prompt).toContain("安全规则");
		expect(prompt).toContain("破坏性操作");
	});

	test("includes built-in SOUL.md when no workspace override", async () => {
		const prompt = await buildSystemPrompt({ cwd: "/tmp/test", tools: [] });
		expect(prompt).toContain("我是谁");
	});

	test("workspace soul overrides built-in", async () => {
		const prompt = await buildSystemPrompt({
			cwd: "/tmp/test",
			tools: [],
			workspace: { soul: "# Custom Soul\nI am a custom agent." },
		});
		expect(prompt).toContain("Custom Soul");
		expect(prompt).toContain("I am a custom agent.");
	});

	test("workspace agents overrides built-in", async () => {
		const prompt = await buildSystemPrompt({
			cwd: "/tmp/test",
			tools: [],
			workspace: { agents: "# My Rules\nAlways be concise." },
		});
		expect(prompt).toContain("My Rules");
		expect(prompt).toContain("Always be concise.");
	});

	test("includes environment section with cwd", async () => {
		const prompt = await buildSystemPrompt({ cwd: "/Users/test/project", tools: [] });
		expect(prompt).toContain("/Users/test/project");
		expect(prompt).toContain("Working directory");
	});

	test("includes tool descriptions when tools provided", async () => {
		const { z } = await import("zod");
		const prompt = await buildSystemPrompt({
			cwd: "/tmp/test",
			tools: [
				{
					name: "read_file",
					label: "Read File",
					description: "Read the contents of a file",
					parameters: z.object({ path: z.string() }),
					execute: async () => "content",
				},
			],
		});
		expect(prompt).toContain("read_file");
		expect(prompt).toContain("Read the contents of a file");
	});

	test("omits tool section when no tools", async () => {
		const prompt = await buildSystemPrompt({ cwd: "/tmp/test", tools: [] });
		expect(prompt).not.toContain("Available Tools");
	});

	test("section order: STATIC before SOUL before environment", async () => {
		const prompt = await buildSystemPrompt({ cwd: "/tmp/test", tools: [] });
		const staticIdx = prompt.indexOf("安全规则");
		const soulIdx = prompt.indexOf("我是谁");
		const envIdx = prompt.indexOf("Working directory");

		expect(staticIdx).toBeLessThan(soulIdx);
		expect(soulIdx).toBeLessThan(envIdx);
	});
});
