import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeExecutionEnvironment } from "../../../src/node";

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

describe("NodeExecutionEnvironment", () => {
	test("canonicalizes existing and missing paths and rejects boundary escapes", async () => {
		const workspace = await temporaryDirectory("jai-env-");
		const outside = await temporaryDirectory("jai-outside-");
		await writeFile(join(workspace, "file.txt"), "ok");
		await writeFile(join(outside, "secret.txt"), "secret");
		await symlink(outside, join(workspace, "link"));
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		expect(
			await environment.resolvePath("file.txt", {
				base: workspace,
				boundary: workspace,
				mustExist: true,
				expectedKind: "file",
			}),
		).toEqual({
			path: await realpath(join(workspace, "file.txt")),
			canonicalPath: await realpath(join(workspace, "file.txt")),
		});
		expect(
			(
				await environment.resolvePath("new/file.txt", {
					base: workspace,
					boundary: workspace,
					mustExist: false,
				})
			).canonicalPath,
		).toBe(join(await realpath(workspace), "new", "file.txt"));
		await expect(
			environment.resolvePath("link/secret.txt", {
				base: workspace,
				boundary: workspace,
				mustExist: true,
			}),
		).rejects.toMatchObject({ code: "filesystem.outside_boundary" });
		await expect(
			environment.resolvePath("../outside.txt", {
				base: workspace,
				boundary: workspace,
				mustExist: false,
			}),
		).rejects.toMatchObject({ code: "filesystem.outside_boundary" });
	});

	test("atomic writes create, replace, preserve mode, and honor abort", async () => {
		const workspace = await temporaryDirectory("jai-atomic-");
		const path = join(workspace, "file.txt");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		expect((await environment.writeFileAtomic(path, "first")).created).toBe(true);
		await chmod(path, 0o640);
		expect((await environment.writeFileAtomic(path, "second")).created).toBe(false);
		expect(await readFile(path, "utf8")).toBe("second");
		expect((await stat(path)).mode & 0o777).toBe(0o640);
		const controller = new AbortController();
		controller.abort();
		await expect(
			environment.writeFileAtomic(path, "changed", { signal: controller.signal }),
		).rejects.toMatchObject({ code: "filesystem.aborted" });
		expect(await readFile(path, "utf8")).toBe("second");
	});

	test("maps unavailable ripgrep and shell to stable codes", async () => {
		const workspace = await temporaryDirectory("jai-errors-");
		const environment = new NodeExecutionEnvironment({
			cwd: workspace,
			ripgrepPath: join(workspace, "missing-rg"),
			shellPath: join(workspace, "missing-shell"),
		});
		await expect(
			environment.glob({ cwd: workspace, pattern: "*", limit: 10 }),
		).rejects.toMatchObject({ code: "filesearch.backend_unavailable" });
		await expect(
			environment.execute("true", { cwd: workspace, timeoutMs: 100 }),
		).rejects.toMatchObject({ code: "shell.shell_unavailable" });
	});

	test("maps invalid search patterns and pre-abort to stable codes", async () => {
		const workspace = await temporaryDirectory("jai-search-errors-");
		await writeFile(join(workspace, "file.txt"), "contents");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		await expect(
			environment.grep({
				cwd: workspace,
				target: ".",
				pattern: "[",
				limit: 10,
			}),
		).rejects.toMatchObject({ code: "filesearch.invalid_pattern" });
		const controller = new AbortController();
		controller.abort();
		await expect(
			environment.glob({
				cwd: workspace,
				pattern: "*",
				limit: 10,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "filesearch.aborted" });
	});

	test("marks truncated ripgrep stderr", async () => {
		const workspace = await temporaryDirectory("jai-search-stderr-");
		const ripgrep = join(workspace, "fake-rg");
		await writeFile(
			ripgrep,
			"#!/bin/sh\ndd if=/dev/zero bs=60000 count=1 2>/dev/null | tr '\\0' x >&2\nexit 2\n",
		);
		await chmod(ripgrep, 0o755);
		const environment = new NodeExecutionEnvironment({ cwd: workspace, ripgrepPath: ripgrep });
		await expect(environment.glob({ cwd: workspace, pattern: "*", limit: 10 })).rejects.toThrow(
			"[stderr truncated]",
		);
	});

	test("shell streams output, returns non-zero, and maps timeout and callback failures", async () => {
		const workspace = await temporaryDirectory("jai-shell-");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		const output: string[] = [];
		const result = await environment.execute("printf out; printf err >&2; exit 4", {
			cwd: workspace,
			timeoutMs: 1_000,
			onOutput: (chunk) => {
				output.push(`${chunk.stream}:${chunk.text}`);
			},
		});
		expect(result.exitCode).toBe(4);
		expect(output.join("")).toContain("stdout:out");
		expect(output.join("")).toContain("stderr:err");
		let activeCallbacks = 0;
		let maxActiveCallbacks = 0;
		const asyncOutput: string[] = [];
		await environment.execute("printf one; sleep 0.02; printf two >&2; sleep 0.02; printf three", {
			cwd: workspace,
			timeoutMs: 1_000,
			onOutput: async (chunk) => {
				activeCallbacks++;
				maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks);
				await Bun.sleep(10);
				asyncOutput.push(chunk.text);
				activeCallbacks--;
			},
		});
		expect(maxActiveCallbacks).toBe(1);
		expect(asyncOutput.join("")).toContain("onetwothree");
		const settledCallbacks = asyncOutput.length;
		await Bun.sleep(20);
		expect(asyncOutput).toHaveLength(settledCallbacks);
		await expect(
			environment.execute("sleep 2", { cwd: workspace, timeoutMs: 20 }),
		).rejects.toMatchObject({ code: "shell.timeout" });
		await expect(
			environment.execute("printf output; sleep 1", {
				cwd: workspace,
				timeoutMs: 2_000,
				onOutput: async () => {
					throw new Error("callback");
				},
			}),
		).rejects.toMatchObject({ code: "shell.output_callback_failed" });
	});
});
