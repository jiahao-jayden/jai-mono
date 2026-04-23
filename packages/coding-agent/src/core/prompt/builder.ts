import type { AgentTool } from "@jayden/jai-agent";
import type { ResolvedPrompts } from "../config/workspace.js";

// ── Types ─────────────────────────────────────────────────

type PromptSection = {
	name: string;
	content: string | null;
};

export type SystemPromptContext = {
	cwd: string;
	tools: AgentTool[];
	prompts: ResolvedPrompts;
};

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
	const now = new Date();
	const localTime = new Intl.DateTimeFormat("sv-SE", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).format(now);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
	const platform = process.platform;
	const shell = process.env.SHELL ?? "unknown";

	return {
		name: "environment",
		content: [
			"# Environment",
			"",
			`- **Current local time**: ${localTime} (${timeZone})`,
			`- **OS**: ${platform}`,
			`- **Shell**: ${shell}`,
			`- **Working directory**: ${cwd}`,
		].join("\n"),
	};
}

// ── Main ──────────────────────────────────────────────────

export function buildSystemPrompt(ctx: SystemPromptContext): string {
	const sections: PromptSection[] = [
		{ name: "static", content: ctx.prompts.static },
		{ name: "agents", content: ctx.prompts.agents },
		{ name: "tools_config", content: ctx.prompts.tools },
		{ name: "soul", content: ctx.prompts.soul },
		toolDescriptions(ctx.tools),
		environment(ctx.cwd),
	];

	return sections
		.filter((s): s is PromptSection & { content: string } => s.content != null && s.content.trim() !== "")
		.map((s) => s.content)
		.join("\n\n");
}
