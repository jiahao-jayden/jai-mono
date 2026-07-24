import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspacePath } from "../../src/internal/workspace";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("resolveWorkspacePath", () => {
	test("resolves existing and new paths inside the workspace", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		await mkdir(join(workspace, "src"));
		await writeFile(join(workspace, "src", "index.ts"), "");

		expect(
			await resolveWorkspacePath(workspace, "src/index.ts", {
				mustExist: true,
				expectedType: "file",
			}),
		).toBe(await realpath(join(workspace, "src", "index.ts")));
		expect(
			await resolveWorkspacePath(workspace, "new/file.ts", {
				mustExist: false,
				expectedType: "file",
			}),
		).toBe(join(await realpath(workspace), "new", "file.ts"));
	});

	test("rejects lexical and symlink escapes", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		const outside = await temporaryDirectory("jai-outside-");
		await writeFile(join(outside, "secret.txt"), "secret");
		await symlink(outside, join(workspace, "link"));

		await expect(
			resolveWorkspacePath(workspace, "../outside.txt", {
				mustExist: false,
			}),
		).rejects.toThrow("Path escapes workspace");
		await expect(
			resolveWorkspacePath(workspace, "link/secret.txt", {
				mustExist: true,
			}),
		).rejects.toThrow("Path escapes workspace");
	});

	test("supports an explicit outside-workspace escape hatch", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		const outside = await temporaryDirectory("jai-outside-");
		const file = join(outside, "file.txt");
		await writeFile(file, "contents");

		expect(
			await resolveWorkspacePath(workspace, file, {
				mustExist: true,
				expectedType: "file",
				allowOutsideWorkspace: true,
			}),
		).toBe(await realpath(file));
	});
});
