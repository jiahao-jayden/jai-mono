import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkillsCommands } from "../src/skills";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("discoverSkillsCommands", () => {
	test("投影用户 Skills 和 prompt template，隔离未信任项目与 plugin skill", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-skill-command-discovery-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const workspaceDirectory = join(root, "workspace");
		await Promise.all([
			writeSkill(join(homeDirectory, ".agents", "skills"), "review", "Review changes"),
			writeSkill(join(homeDirectory, ".agents", "skills"), "manual-review", "Manual review"),
			writeSkill(join(homeDirectory, ".agents", "skills"), "private-review", "Private review"),
			writeCommand(join(homeDirectory, ".agents", "commands"), "summarize", "Summarize a target", "<target>"),
			writeSkill(join(workspaceDirectory, ".agents", "skills"), "project-review", "Project review"),
			writeCommand(join(workspaceDirectory, ".agents", "commands"), "project-note", "Project note"),
		]);

		const commands = await discoverSkillsCommands({
			homeDirectory,
			workspaceDirectory,
			workspaceTrusted: false,
			pluginSkills: [pluginSkill(root)],
		});

		expect(commands).toEqual([
			{
				name: "skill:manual-review",
				displayName: "skill:manual-review",
				description: "Load the manual-review Skill into the current prompt",
				kind: "skill",
			},
			{
				name: "skill:private-review",
				displayName: "skill:private-review",
				description: "Load the private-review Skill into the current prompt",
				kind: "skill",
			},
			{
				name: "skill:review",
				displayName: "skill:review",
				description: "Load the review Skill into the current prompt",
				kind: "skill",
			},
			{
				name: "summarize",
				displayName: "summarize",
				description: "Summarize a target",
				kind: "file",
				argumentHint: "<target>",
			},
		]);
	});
});

async function writeSkill(directory: string, name: string, description: string): Promise<void> {
	const skillDirectory = join(directory, name);
	await mkdir(skillDirectory, { recursive: true });
	await writeFile(
		join(skillDirectory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${description}\n`,
	);
}

async function writeCommand(
	directory: string,
	name: string,
	description: string,
	argumentHint?: string,
): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, `${name}.md`),
		`---\ndescription: ${description}${argumentHint ? `\nargument-hint: ${argumentHint}` : ""}\n---\n\n# ${description}\n`,
	);
}

function pluginSkill(root: string) {
	return {
		name: "plugin-review",
		description: "Plugin review",
		contentRevision: "test",
		location: join(root, "plugin-review", "SKILL.md"),
		directory: join(root, "plugin-review"),
		canonicalDirectory: join(root, "plugin-review"),
		source: {
			scope: "user" as const,
			directory: "plugin" as const,
			pluginName: "example",
			pluginRoot: join(root, "plugin"),
		},
		allowedTools: [],
		metadata: {},
	};
}
