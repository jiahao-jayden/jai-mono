import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../src/core/prompt/builder.js";
import type { ResolvedPrompts } from "../src/core/config/workspace.js";

const MOCK_PROMPTS: ResolvedPrompts = {
	static: "# Static\n安全规则\n破坏性操作",
	soul: "# Soul\n我是谁",
	agents: "# Agents\n工作纪律",
	tools: "# Tools\n环境约定",
};

describe("buildSystemPrompt", () => {
	test("includes all prompt sections", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/test", tools: [], prompts: MOCK_PROMPTS });
		expect(prompt).toContain("安全规则");
		expect(prompt).toContain("我是谁");
		expect(prompt).toContain("工作纪律");
		expect(prompt).toContain("环境约定");
	});

	test("custom prompts replace defaults", () => {
		const prompts: ResolvedPrompts = {
			...MOCK_PROMPTS,
			soul: "# Custom Soul\nI am a custom agent.",
		};
		const prompt = buildSystemPrompt({ cwd: "/tmp/test", tools: [], prompts });
		expect(prompt).toContain("Custom Soul");
		expect(prompt).not.toContain("我是谁");
	});

	test("includes environment section with cwd", () => {
		const prompt = buildSystemPrompt({ cwd: "/Users/test/project", tools: [], prompts: MOCK_PROMPTS });
		expect(prompt).toContain("/Users/test/project");
		expect(prompt).toContain("Working directory");
	});

	test("includes tool descriptions when tools provided", async () => {
		const { z } = await import("zod");
		const prompt = buildSystemPrompt({
			cwd: "/tmp/test",
			prompts: MOCK_PROMPTS,
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

	test("omits tool section when no tools", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/test", tools: [], prompts: MOCK_PROMPTS });
		expect(prompt).not.toContain("Available Tools");
	});

	test("section order: static before soul before environment", () => {
		const prompt = buildSystemPrompt({ cwd: "/tmp/test", tools: [], prompts: MOCK_PROMPTS });
		const staticIdx = prompt.indexOf("安全规则");
		const soulIdx = prompt.indexOf("我是谁");
		const envIdx = prompt.indexOf("Working directory");

		expect(staticIdx).toBeLessThan(soulIdx);
		expect(soulIdx).toBeLessThan(envIdx);
	});
});
