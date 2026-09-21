import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSafeShellEnvironment, NodeExecutionEnvironment } from "../../../src/node/environment";

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

async function expectErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
	try {
		await promise;
		throw new Error(`Expected ${code}`);
	} catch (error) {
		expect(typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined).toBe(code);
	}
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
	}
}

async function waitForFile(path: string): Promise<string> {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			return await readFile(path, "utf8");
		} catch {
			await Bun.sleep(10);
		}
	}
	throw new Error(`Timed out waiting for ${path}`);
}

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
		await expectErrorCode(
			environment.resolvePath("link/secret.txt", {
				base: workspace,
				boundary: workspace,
				mustExist: true,
			}),
			"filesystem.outside_boundary",
		);
		await expectErrorCode(
			environment.resolvePath("../outside.txt", {
				base: workspace,
				boundary: workspace,
				mustExist: false,
			}),
			"filesystem.outside_boundary",
		);
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
		await expectErrorCode(
			environment.writeFileAtomic(path, "changed", { signal: controller.signal }),
			"filesystem.aborted",
		);
		expect(await readFile(path, "utf8")).toBe("second");
	});

	test("maps an unavailable shell to a stable code", async () => {
		const workspace = await temporaryDirectory("jai-errors-");
		const environment = new NodeExecutionEnvironment({
			cwd: workspace,
			shellPath: join(workspace, "missing-shell"),
		});
		await expectErrorCode(
			environment.execute("true", { cwd: workspace, timeoutMs: 100 }),
			"shell.shell_unavailable",
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
		await expectErrorCode(
			environment.execute("sleep 2", { cwd: workspace, timeoutMs: 20 }),
			"shell.timeout",
		);
		await expectErrorCode(
			environment.execute("printf output; sleep 1", {
				cwd: workspace,
				timeoutMs: 2_000,
				onOutput: async () => {
					throw new Error("callback");
				},
			}),
			"shell.output_callback_failed",
		);
	});

	test.skipIf(process.platform === "win32")(
		"hard-kills a TERM-ignoring descendant after the parent shell exits",
		async () => {
			const workspace = await temporaryDirectory("jai-shell-group-");
			const scriptPath = join(workspace, "ignore-term.mjs");
			const pidPath = join(workspace, "descendant.pid");
			await writeFile(
				scriptPath,
				`import { writeFileSync } from "node:fs";\nprocess.on("SIGTERM", () => {});\nwriteFileSync(${JSON.stringify(pidPath)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
			);
			const environment = new NodeExecutionEnvironment({ cwd: workspace });
			const controller = new AbortController();
			const execution = environment.execute(
				`${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} </dev/null >/dev/null 2>&1 & wait`,
				{ cwd: workspace, timeoutMs: 10_000, signal: controller.signal },
			);
			const descendantPid = Number.parseInt(await waitForFile(pidPath), 10);
			expect(processExists(descendantPid)).toBe(true);

			controller.abort();
			await expectErrorCode(execution, "shell.aborted");
			await Bun.sleep(1_200);

			try {
				expect(processExists(descendantPid)).toBe(false);
			} finally {
				if (processExists(descendantPid)) process.kill(descendantPid, "SIGKILL");
			}
		},
	);

	test("bounds shell output and reports truncation", async () => {
		const workspace = await temporaryDirectory("jai-shell-limit-");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		const result = await environment.execute("yes x | head -c 2000000", {
			cwd: workspace,
			timeoutMs: 2_000,
			onOutput: () => undefined,
		});
		expect(result.truncated).toBe(true);
	});

	test("Shell policy only receives its explicit environment allowlist", async () => {
		const workspace = await temporaryDirectory("jai-shell-environment-");
		const environment = new NodeExecutionEnvironment({ cwd: workspace });
		const shellEnvironment = createSafeShellEnvironment({}, { PATH: process.env.PATH, API_TOKEN: "host-secret" });
		expect(shellEnvironment.API_TOKEN).toBeUndefined();
		const output: string[] = [];
		await environment.withExecutionPolicy(
			{
				version: "policy-env",
				workspaceRoot: workspace,
				writableRoots: [workspace],
				deniedReadPaths: [],
				deniedWritePaths: [],
				environment: shellEnvironment,
			},
			() =>
				environment.execute('printf "${API_TOKEN-unset}"', {
					cwd: workspace,
					timeoutMs: 1_000,
					onOutput: (chunk) => {
						output.push(chunk.text);
					},
				}),
		);
		expect(output.join("")).toBe("unset");
	});
});
