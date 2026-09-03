import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { FRONTIER_HARNESS_REVISION, readFrontierTaskDefinition } from "../src/core/task-definition";

describe("readFrontierTaskDefinition", () => {
	test("accepts the public Terminal-Bench no-internet task shape", async () => {
		const directory = await taskDirectory(`
artifacts = []
[task]
name = "terminal-bench/build-cython-ext"
[agent]
timeout_sec = 900.0
[environment]
docker_image = "example/build-cython-ext:fixed"
cpus = 1
memory_mb = 2048
storage_mb = 10240
gpus = 0
allow_internet = false
[environment.env]
PATH = "/app/.venv/bin:/usr/bin"
`);
		try {
			const parsed = await readFrontierTaskDefinition(directory);
			expect(parsed.isOk()).toBe(true);
			if (parsed.isErr()) throw parsed.error;
			expect(parsed.value).toMatchObject({
				sourceRevision: FRONTIER_HARNESS_REVISION,
				name: "terminal-bench/build-cython-ext",
				agentTimeoutMs: 900_000,
				limits: { cpus: 1, memoryMb: 2048, storageMb: 10240 },
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("accepts the public DeepSWE no-network task shape", async () => {
		const directory = await taskDirectory(`
artifacts = ["/logs/artifacts/model.patch"]
[task]
name = "datacurve/anko-typed-variable-bindings"
[agent]
timeout_sec = 5400.0
network_mode = "no-network"
[environment]
docker_image = "public.ecr.aws/example:fixed"
cpus = 2
memory_mb = 8192
storage_mb = 20480
gpus = 0
[environment.env]
`);
		try {
			const parsed = await readFrontierTaskDefinition(directory);
			expect(parsed.isOk()).toBe(true);
			if (parsed.isErr()) throw parsed.error;
			expect(parsed.value.name).toBe("datacurve/anko-typed-variable-bindings");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("fails closed for direct internet or JAI environment overrides", async () => {
		const internet = await taskDirectory(`
artifacts = []
[task]
name = "internet-task"
[agent]
timeout_sec = 1
[environment]
docker_image = "example/task"
cpus = 1
memory_mb = 1
storage_mb = 1
allow_internet = true
`);
		const override = await taskDirectory(`
artifacts = []
[task]
name = "override-task"
[agent]
timeout_sec = 1
[environment]
docker_image = "example/task"
cpus = 1
memory_mb = 1
storage_mb = 1
allow_internet = false
[environment.env]
JAI_HOME = "/app/steal-config"
`);
		try {
			const internetResult = await readFrontierTaskDefinition(internet);
			const overrideResult = await readFrontierTaskDefinition(override);
			expect(internetResult.isErr() && internetResult.error._tag).toBe("frontier_smoke.constraint_unsupported");
			expect(overrideResult.isErr() && overrideResult.error._tag).toBe("frontier_smoke.constraint_unsupported");
		} finally {
			await Promise.all([rm(internet, { recursive: true, force: true }), rm(override, { recursive: true, force: true })]);
		}
	});
});

async function taskDirectory(manifest: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jai-frontier-task-"));
	await Promise.all([
		writeFile(join(directory, "instruction.md"), "Fix the task.\n"),
		writeFile(join(directory, "task.toml"), manifest.trim()),
	]);
	return directory;
}
