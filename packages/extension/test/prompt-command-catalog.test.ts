import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodingPromptCommandCatalog, expandPromptCommandTemplate } from "../src/skills";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodingPromptCommandCatalog", () => {
	test("按项目 .jai、项目 .agents、用户 .jai、用户 .agents 的顺序解析同名 Command", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-prompt-commands-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const workspaceDirectory = join(root, "workspace");
		await Promise.all([
			writeCommand(join(homeDirectory, ".agents", "commands"), "review", "User agents"),
			writeCommand(join(homeDirectory, ".jai", "commands"), "review", "User jai"),
			writeCommand(join(workspaceDirectory, ".agents", "commands"), "review", "Project agents"),
			writeCommand(join(workspaceDirectory, ".jai", "commands"), "review", "Project jai"),
		]);
		const catalog = new CodingPromptCommandCatalog({ homeDirectory, workspaceDirectory, workspaceTrusted: true });

		const snapshot = await catalog.load();

		expect(snapshot.commands).toEqual([
			expect.objectContaining({
				name: "review",
				description: "Project jai",
				source: { scope: "project", directory: ".jai" },
			}),
		]);
		expect(snapshot.diagnostics.filter((entry) => entry.code === "shadowed")).toHaveLength(3);
		catalog.close();
	});

	test("未信任 workspace 隔离 project command，并隔离无效 frontmatter 和越界 symlink", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-prompt-command-trust-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const workspaceDirectory = join(root, "workspace");
		const commandsDirectory = join(homeDirectory, ".agents", "commands");
		await writeCommand(join(workspaceDirectory, ".jai", "commands"), "project-only", "Project only");
		await writeCommand(commandsDirectory, "valid", "Valid");
		await writeFile(join(commandsDirectory, "invalid.md"), "---\nunknown: value\n---\nInvalid");
		const outside = join(homeDirectory, "outside.md");
		await writeFile(outside, "Outside");
		await symlink(outside, join(commandsDirectory, "escaped.md"));
		const catalog = new CodingPromptCommandCatalog({
			homeDirectory,
			workspaceDirectory,
			workspaceTrusted: false,
		});

		const snapshot = await catalog.load();

		expect(snapshot.commands.map((command) => command.name)).toEqual(["valid"]);
		expect(snapshot.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "invalid", commandName: "invalid" }),
				expect.objectContaining({ code: "invalid", commandName: "escaped" }),
			]),
		);
		catalog.close();
	});

	test("watcher 生成新 snapshot，模板替换只扫描一次", async () => {
		const root = await mkdtemp(join(tmpdir(), "jai-prompt-command-watch-"));
		roots.push(root);
		const homeDirectory = join(root, "home");
		const commandsDirectory = join(homeDirectory, ".agents", "commands");
		await writeCommand(commandsDirectory, "review", "Review");
		const catalog = new CodingPromptCommandCatalog({ homeDirectory, workspaceTrusted: false, debounceMs: 5 });
		const initial = await catalog.load();
		const changed = new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Timed out waiting for prompt command watcher")), 10_000);
			catalog.watch(() => {
				clearTimeout(timeout);
				resolve();
			});
		});

		await writeCommand(commandsDirectory, "second", "Second");
		await changed;

		expect(initial.commands.map((command) => command.name)).toEqual(["review"]);
		expect(catalog.snapshot.commands.map((command) => command.name)).toEqual(["review", "second"]);
		expect(expandPromptCommandTemplate("$1 | $2 | $@ | $ARGUMENTS | $10 | $ARGUMENTS", "first second  ")).toBe(
			"first | second | first second   | first second   |  | first second  ",
		);
		catalog.close();
	}, 15_000);
});

async function writeCommand(directory: string, name: string, description: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, `${name}.md`),
		`---\ndescription: ${description}\nargument-hint: <target>\n---\n\n# ${description}\n`,
	);
}
