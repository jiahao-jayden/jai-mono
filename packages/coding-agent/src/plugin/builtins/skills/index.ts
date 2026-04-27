import { readFile } from "node:fs/promises";
import z from "zod";
import { expandTemplate } from "../../host/commands.js";
import type { PluginAPI, PluginCommandContext } from "../../types.js";
import { discoverSkills } from "./discovery.js";
import type { InvokedSkillInfo, SkillInfo } from "./types.js";

// TODO(skill-watcher): 结构热更新（新增/删除 SKILL.md 自动注册/反注册）
//   需要扩展 PluginAPI: unregisterCommand / unregisterTool / replaceTool
//   配合 chokidar watcher，参考 we0agent skill_watcher 设计。
//   当前实现只支持「内容热更新」：command handler 运行时 readFile 拿最新 body。

const SKILL_TOOL_NAME = "Skill";
const ARGUMENTS_PLACEHOLDER = /\$ARGUMENTS/;

function appendOrExpandArgs(content: string, args: string): string {
	if (ARGUMENTS_PLACEHOLDER.test(content)) {
		return expandTemplate(content, args);
	}
	return `${content}\n\n---\n\n## User Request\n\n${args}`;
}

export type SkillsPluginContext = {
	cwd: string;
	jaiHome: string;
	onSkillInvoked: (info: InvokedSkillInfo) => void;
};

function buildToolDescription(skills: SkillInfo[]): string {
	const visible = skills.filter((s) => !s.frontmatter["disable-model-invocation"]);
	if (visible.length === 0) {
		return "Load a skill by name. No skills are currently available.";
	}

	const listing = visible.map((s) => `- **${s.name}**: ${s.description}`).join("\n");

	return `Load a skill's instructions into the conversation. Use when a task matches an available skill.

Available skills:

${listing}

Invoke a skill when the user's request matches its description. The skill's full instructions will be returned and should be followed for the remainder of the task.`;
}

function buildSkillsSummary(skills: SkillInfo[]): string {
	const visible = skills.filter((s) => !s.frontmatter["disable-model-invocation"]);
	if (visible.length === 0) return "";

	const listing = visible.map((s) => `- ${s.name}: ${s.description}`).join("\n");

	return `## Available Skills

When a task matches an available skill, use the Skill tool to load its full instructions.

${listing}`;
}

export async function loadBuiltinSkillsPlugin(
	jai: PluginAPI,
	ctx: SkillsPluginContext,
): Promise<{ skills: SkillInfo[] }> {
	const skills = await discoverSkills({
		cwd: ctx.cwd,
		jaiHome: ctx.jaiHome,
		log: jai.log,
	});

	if (skills.length === 0) {
		jai.log.info("skills: no skills discovered");
		return { skills };
	}

	jai.log.info(`skills: discovered ${skills.length} skill(s)`);

	const skillByName = new Map(skills.map((s) => [s.name, s]));

	jai.registerTool({
		name: SKILL_TOOL_NAME,
		label: "Load skill",
		description: buildToolDescription(skills),
		parameters: z.object({
			name: z.string().describe("Name of the skill to load."),
			arguments: z.string().optional().describe("Optional arguments to pass to the skill."),
		}),
		async execute({ name, arguments: args }: { name: string; arguments?: string }) {
			const skill = skillByName.get(name);
			if (!skill) {
				const known = Array.from(skillByName.keys()).join(", ");
				return {
					content: [{ type: "text" as const, text: `Unknown skill "${name}". Available: ${known}` }],
					isError: true,
				};
			}

			let content: string;
			try {
				const raw = await readFile(skill.path, "utf8");
				const bodyStart = raw.indexOf("\n---", 3);
				content = bodyStart !== -1 ? raw.slice(bodyStart + 4).trim() : raw;
			} catch {
				content = skill.body;
			}

			if (args) {
				content = appendOrExpandArgs(content, args);
			}

			ctx.onSkillInvoked({
				skillName: name,
				skillPath: skill.path,
				content,
				invokedAt: Date.now(),
			});

			return {
				content: [{ type: "text" as const, text: `# Skill: ${name}\n\n${content}` }],
			};
		},
	});

	const summary = buildSkillsSummary(skills);
	if (summary) {
		jai.on("preModelRequest", (ctx) => {
			const base = ctx.systemPrompt ?? "";
			return { systemPrompt: `${base}\n\n${summary}` };
		});
	}

	for (const skill of skills) {
		if (skill.frontmatter["user-invocable"] === false) continue;

		jai.registerCommand(skill.name, {
			description: skill.description,
			argumentHint: skill.frontmatter["argument-hint"],
			handler: async (args: string, cmdCtx: PluginCommandContext) => {
				let body: string;
				try {
					const raw = await readFile(skill.path, "utf8");
					const bodyStart = raw.indexOf("\n---", 3);
					body = bodyStart !== -1 ? raw.slice(bodyStart + 4).trim() : raw;
				} catch {
					body = skill.body;
				}

				const content = args ? appendOrExpandArgs(body, args) : body;

				ctx.onSkillInvoked({
					skillName: skill.name,
					skillPath: skill.path,
					content,
					invokedAt: Date.now(),
				});

				await cmdCtx.sendUserMessage(`# Skill: ${skill.name}\n\n${content}`);
			},
		});
	}

	return { skills };
}
