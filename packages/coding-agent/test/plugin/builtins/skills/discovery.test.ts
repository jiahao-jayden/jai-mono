import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills } from "../../../../src/plugin/builtins/skills/discovery.js";

const TMP_ROOT = join(tmpdir(), `skills-test-${Date.now()}`);
const CWD = join(TMP_ROOT, "project");
const JAI_HOME = join(TMP_ROOT, "jai-home");

async function writeSkill(dir: string, name: string, frontmatter: string, body: string): Promise<void> {
	const skillDir = join(dir, name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
}

afterEach(async () => {
	await rm(TMP_ROOT, { recursive: true, force: true });
});

describe("discoverSkills", () => {
	test("discovers skills from project .jai/skills", async () => {
		const skillsDir = join(CWD, ".jai", "skills");
		await writeSkill(skillsDir, "test-skill", 'description: "A test skill"', "Do the thing.");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("test-skill");
		expect(skills[0].description).toBe("A test skill");
		expect(skills[0].body).toBe("Do the thing.");
		expect(skills[0].source).toBe("project-jai");
	});

	test("discovers skills from global ~/.jai/skills", async () => {
		const skillsDir = join(JAI_HOME, "skills");
		await writeSkill(skillsDir, "global-skill", 'description: "Global skill"', "Global body.");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("global-skill");
		expect(skills[0].source).toBe("global-jai");
	});

	test("discovers skills from project .agents/skills", async () => {
		const skillsDir = join(CWD, ".agents", "skills");
		await writeSkill(skillsDir, "agents-skill", 'description: "Agents skill"', "Agents body.");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("agents-skill");
		expect(skills[0].source).toBe("project-agents");
	});

	test("deduplicates by priority: project .jai > project .agents > global .jai", async () => {
		await writeSkill(join(CWD, ".jai", "skills"), "my-skill", 'description: "project-jai version"', "project jai");
		await writeSkill(
			join(CWD, ".agents", "skills"),
			"my-skill",
			'description: "project-agents version"',
			"project agents",
		);
		await writeSkill(join(JAI_HOME, "skills"), "my-skill", 'description: "global version"', "global");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(1);
		expect(skills[0].description).toBe("project-jai version");
		expect(skills[0].source).toBe("project-jai");
	});

	test("returns empty array when no skill directories exist", async () => {
		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(0);
	});

	test("skips directories without SKILL.md", async () => {
		const skillsDir = join(CWD, ".jai", "skills", "empty-dir");
		await mkdir(skillsDir, { recursive: true });
		await writeFile(join(skillsDir, "README.md"), "Not a skill");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(0);
	});

	test("uses directory name as skill name when frontmatter name is absent", async () => {
		const skillsDir = join(CWD, ".jai", "skills");
		await writeSkill(skillsDir, "my-dir-name", 'description: "No name field"', "Body.");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("my-dir-name");
	});

	test("uses frontmatter name over directory name", async () => {
		const skillsDir = join(CWD, ".jai", "skills");
		await writeSkill(skillsDir, "dir-name", 'name: custom-name\ndescription: "Custom"', "Body.");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("custom-name");
	});

	test("handles SKILL.md without frontmatter", async () => {
		const skillDir = join(CWD, ".jai", "skills", "no-fm");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "Just a body, no frontmatter.");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("no-fm");
		expect(skills[0].description).toBe("Just a body, no frontmatter.");
	});

	test("results are sorted by name", async () => {
		const skillsDir = join(CWD, ".jai", "skills");
		await writeSkill(skillsDir, "zebra", 'description: "Z"', "Z body.");
		await writeSkill(skillsDir, "alpha", 'description: "A"', "A body.");
		await writeSkill(skillsDir, "middle", 'description: "M"', "M body.");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills.map((s) => s.name)).toEqual(["alpha", "middle", "zebra"]);
	});

	test("merges skills from multiple directories", async () => {
		await writeSkill(join(CWD, ".jai", "skills"), "proj-only", 'description: "Project only"', "p");
		await writeSkill(join(JAI_HOME, "skills"), "global-only", 'description: "Global only"', "g");

		const skills = await discoverSkills({ cwd: CWD, jaiHome: JAI_HOME });
		expect(skills).toHaveLength(2);
		expect(skills.map((s) => s.name)).toEqual(["global-only", "proj-only"]);
	});
});
