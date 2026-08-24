import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnvironment } from "../../../src/node/environment";

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

describe("NodeExecutionEnvironment.resolvePath", () => {
	test("resolves existing and new paths inside the workspace", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		await mkdir(join(workspace, "src"));
		await writeFile(join(workspace, "src", "index.ts"), "");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });

		expect(
			(
				await environment.resolvePath("src/index.ts", {
					base: workspace,
					boundary: workspace,
					mustExist: true,
					expectedKind: "file",
				})
			).path,
		).toBe(await realpath(join(workspace, "src", "index.ts")));
		expect(
			(
				await environment.resolvePath("new/file.ts", {
					base: workspace,
					boundary: workspace,
					mustExist: false,
					expectedKind: "file",
				})
			).path,
		).toBe(join(await realpath(workspace), "new", "file.ts"));
	});

	test("rejects lexical and symlink escapes", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		const outside = await temporaryDirectory("jai-outside-");
		await writeFile(join(outside, "secret.txt"), "secret");
		await symlink(outside, join(workspace, "link"));
		const environment = new NodeExecutionEnvironment({ cwd: workspace });

		await expect(
			environment.resolvePath("../outside.txt", {
				base: workspace,
				boundary: workspace,
				mustExist: false,
			}),
		).rejects.toThrow("Path escapes workspace");
		await expect(
			environment.resolvePath("link/secret.txt", {
				base: workspace,
				boundary: workspace,
				mustExist: true,
			}),
		).rejects.toThrow("Path escapes workspace");
	});

	test("does not provide an outside-workspace escape hatch", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		const outside = await temporaryDirectory("jai-outside-");
		const file = join(outside, "file.txt");
		await writeFile(file, "contents");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });

		await expect(
			environment.resolvePath(file, {
				base: workspace,
				boundary: workspace,
				mustExist: true,
				expectedKind: "file",
			}),
		).rejects.toThrow("Path escapes workspace");
	});

	test("allows one exact outside path only inside an issued capability scope", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		const outside = await temporaryDirectory("jai-outside-");
		const file = join(outside, "file.txt");
		await writeFile(file, "contents");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		const options = {
			base: workspace,
			boundary: workspace,
			mustExist: true,
			expectedKind: "file" as const,
		};
		const capability = await environment.createPathCapability(file, options);

		await expect(environment.resolvePath(file, options)).rejects.toThrow("Path escapes workspace");
		await expect(
			environment.withPathCapability(
				{ requestedPath: capability.requestedPath, canonicalPath: capability.canonicalPath },
				async () => environment.resolvePath(file, options),
			),
		).rejects.toThrow("not issued");
		await environment.withPathCapability(capability, async () => {
			const resolved = await environment.resolvePath(file, options);
			expect(new TextDecoder().decode(await environment.readFile(resolved.path))).toBe("contents");
		});
		await expect(
			environment.withPathCapability(capability, async () => environment.resolvePath(file, options)),
		).rejects.toThrow("not issued");
		await expect(environment.resolvePath(file, options)).rejects.toThrow("Path escapes workspace");
	});

	test("rejects lexical aliases and symlink changes after capability issuance", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		const first = await temporaryDirectory("jai-outside-first-");
		const second = await temporaryDirectory("jai-outside-second-");
		await writeFile(join(workspace, "inside.txt"), "inside");
		await symlink(workspace, join(first, "back-inside"));
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		const options = { base: workspace, boundary: workspace, mustExist: true };

		await expect(environment.resolvePath(join(first, "back-inside", "inside.txt"), options)).rejects.toThrow(
			"Path escapes workspace",
		);

		await writeFile(join(first, "target.txt"), "first");
		await writeFile(join(second, "target.txt"), "second");
		const link = join(workspace, "outside-link");
		await symlink(first, link);
		const input = join(link, "target.txt");
		const capability = await environment.createPathCapability(input, options);
		await unlink(link);
		await symlink(second, link);

		await expect(
			environment.withPathCapability(capability, async () => environment.resolvePath(input, options)),
		).rejects.toThrow("Path escapes workspace");
	});

	test("rechecks an authorized canonical target immediately before I/O", async () => {
		const workspace = await temporaryDirectory("jai-workspace-");
		const outside = await temporaryDirectory("jai-outside-");
		const authorized = join(outside, "authorized.txt");
		const replacement = join(outside, "replacement.txt");
		await writeFile(authorized, "authorized");
		await writeFile(replacement, "replacement");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		const options = {
			base: workspace,
			boundary: workspace,
			mustExist: true,
			expectedKind: "file" as const,
		};
		const capability = await environment.createPathCapability(authorized, options);

		await environment.withPathCapability(capability, async () => {
			const resolved = await environment.resolvePath(authorized, options);
			await unlink(authorized);
			await symlink(replacement, authorized);
			await expect(environment.readFile(resolved.path)).rejects.toThrow(
				"Authorized path changed before execution",
			);
		});
	});
});
