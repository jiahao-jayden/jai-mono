import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodingSkillCatalog, resolveSlashInvocation } from "../src/skills";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodingSkillCatalog", () => {
	test("按项目 .jai、项目 .agents、用户 .jai、用户 .agents 的顺序解析同名 Skill", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-skills-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const workspaceDirectory = join(root, "workspace");
		await Promise.all([
			writeSkill(join(homeDirectory, ".agents", "skills"), "review", "User agents"),
			writeSkill(join(homeDirectory, ".jai", "skills"), "review", "User jai"),
			writeSkill(join(workspaceDirectory, ".agents", "skills"), "review", "Project agents"),
			writeSkill(join(workspaceDirectory, ".jai", "skills"), "review", "Project jai"),
		]);
		const catalog = new CodingSkillCatalog({
			homeDirectory,
			workspaceDirectory,
			workspaceTrusted: true,
		});

		const snapshot = await catalog.load();

		expect(snapshot.skills).toHaveLength(1);
		expect(snapshot.skills[0]).toMatchObject({
			name: "review",
			description: "Project jai",
			source: { scope: "project", directory: ".jai" },
		});
		expect(snapshot.diagnostics.filter((entry) => entry.code === "shadowed")).toHaveLength(3);
		catalog.close();
	});

	test("目录变化生成新 snapshot，但调用方可继续持有旧 snapshot", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-skills-watch-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const skillsDirectory = join(homeDirectory, ".agents", "skills");
		await writeSkill(skillsDirectory, "first", "First");
		const catalog = new CodingSkillCatalog({
			homeDirectory,
			workspaceTrusted: false,
			debounceMs: 5,
		});
		const initial = await catalog.load();
		let cancelChangeWait = () => {};
		const changed = new Promise<Awaited<ReturnType<CodingSkillCatalog["load"]>>>((resolve, reject) => {
			let stop = () => {};
			const timeout = setTimeout(() => {
				stop();
				reject(new Error("Timed out waiting for Skill catalog watcher"));
			}, 10_000);
			cancelChangeWait = () => {
				clearTimeout(timeout);
				stop();
			};
			stop = catalog.watch((snapshot) => {
				cancelChangeWait();
				resolve(snapshot);
			});
		});

		try {
			await writeSkill(skillsDirectory, "second", "Second");
			const refreshed = await changed;

			expect(initial.skills.map((skill) => skill.name)).toEqual(["first"]);
			expect(refreshed.skills.map((skill) => skill.name)).toEqual(["first", "second"]);
			expect(refreshed.revision).not.toBe(initial.revision);
		} finally {
			cancelChangeWait();
			catalog.close();
		}
	}, 15_000);

	test("未信任 Workspace 不加载项目 Skill，并隔离单个无效用户 Skill", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-skills-trust-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const workspaceDirectory = join(root, "workspace");
		await writeSkill(join(workspaceDirectory, ".jai", "skills"), "project-only", "Project only");
		await writeSkill(join(homeDirectory, ".agents", "skills"), "valid", "Valid");
		const invalidDirectory = join(homeDirectory, ".agents", "skills", "invalid");
		await mkdir(invalidDirectory, { recursive: true });
		await writeFile(join(invalidDirectory, "SKILL.md"), "---\nname: wrong\n---\n");
		const catalog = new CodingSkillCatalog({
			homeDirectory,
			workspaceDirectory,
			workspaceTrusted: false,
		});

		const snapshot = await catalog.load();

		expect(snapshot.skills.map((skill) => skill.name)).toEqual(["valid"]);
		expect(snapshot.diagnostics).toEqual([
			expect.objectContaining({ code: "invalid", skillName: "invalid" }),
		]);
		catalog.close();
	});

	test("slash registry 让 command 优先于同名 Skill，未知 slash 保持未解析", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-skills-slash-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		await writeSkill(join(homeDirectory, ".agents", "skills"), "review", "Review changes");
		const catalog = new CodingSkillCatalog({ homeDirectory, workspaceTrusted: false });
		const snapshot = await catalog.load();

		expect(resolveSlashInvocation("/review now", snapshot, new Set(["review"]))).toEqual({
			name: "review",
			kind: "command",
			displayName: "review",
		});
		expect(resolveSlashInvocation("/unknown keep as text", snapshot)).toBeUndefined();
		catalog.close();
	});

	test("仅修改 SKILL.md 正文也会推进 catalog revision", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-skills-revision-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const skillsDirectory = join(homeDirectory, ".agents", "skills");
		await writeSkill(skillsDirectory, "review", "Review changes");
		const catalog = new CodingSkillCatalog({ homeDirectory, workspaceTrusted: false });
		const initial = await catalog.load();

		await writeFile(
			join(skillsDirectory, "review", "SKILL.md"),
			"---\nname: review\ndescription: Review changes\n---\n\n# Updated instructions\n",
		);
		const updated = await catalog.load();

		expect(updated.revision).not.toBe(initial.revision);
		catalog.close();
	});
});

async function writeSkill(directory: string, name: string, description: string): Promise<void> {
	const skillDirectory = join(directory, name);
	await mkdir(skillDirectory, { recursive: true });
	await writeFile(
		join(skillDirectory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\nmetadata:\n  displayName: ${description}\n---\n\n# ${description}\n`,
	);
}
