import { join } from "node:path";
import type { AgentTool } from "@jayden/jai-agent";

// ── Types ─────────────────────────────────────────────────

type PromptSection = {
	name: string;
	content: string | null;
};

export type SystemPromptContext = {
	cwd: string;
	tools: AgentTool[];
	/** 用户 workspace 里的覆盖文件内容 */
	workspace?: {
		soul?: string;
		agents?: string;
		tools?: string;
	};
};

// ── Built-in prompts ──────────────────────────────────────

const PROMPT_DIR = join(import.meta.dirname, "prompt");

async function loadBuiltin(name: string): Promise<string> {
	return Bun.file(join(PROMPT_DIR, name)).text();
}

// ── Section builders ─────────────────────────────────────

function toolDescriptions(tools: AgentTool[]): PromptSection {
	if (tools.length === 0) return { name: "tool_descriptions", content: null };

	const lines = tools.map((t) => `- **${t.name}**: ${t.description}`);
	return {
		name: "tool_descriptions",
		content: `# Available Tools\n\n${lines.join("\n")}`,
	};
}

function environment(cwd: string): PromptSection {
	const date = new Date().toISOString().slice(0, 10);
	const platform = process.platform;
	const shell = process.env.SHELL ?? "unknown";

	return {
		name: "environment",
		content: [
			"# Environment",
			"",
			`- **Date**: ${date}`,
			`- **OS**: ${platform}`,
			`- **Shell**: ${shell}`,
			`- **Working directory**: ${cwd}`,
		].join("\n"),
	};
}

// ── Main ──────────────────────────────────────────────────

export async function buildSystemPrompt(ctx: SystemPromptContext): Promise<string> {
	const sections: PromptSection[] = [
		// 1. STATIC — 内置，不可覆盖
		{ name: "static", content: await loadBuiltin("STATIC.md") },
		// 2. SOUL — 用户可覆盖
		{ name: "soul", content: ctx.workspace?.soul ?? (await loadBuiltin("SOUL.md")) },
		// 3. AGENTS — 用户可覆盖
		{ name: "agents", content: ctx.workspace?.agents ?? (await loadBuiltin("AGENTS.md")) },
		// 4. TOOLS — 用户可覆盖
		{ name: "tools_config", content: ctx.workspace?.tools ?? (await loadBuiltin("TOOLS.md")) },
		// 5. Tool descriptions — 代码生成
		toolDescriptions(ctx.tools),
		// 6. Environment — 代码生成
		environment(ctx.cwd),
	];

	return sections
		.filter((s): s is PromptSection & { content: string } => s.content != null && s.content.trim() !== "")
		.map((s) => s.content)
		.join("\n\n");
}
