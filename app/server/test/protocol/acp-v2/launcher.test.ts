import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectJaiRuntimeHost, isLocalRuntimeHostStale, stopLocalRuntimeHost } from "../../../src/acp-client";
import { openLocalAcpV2Server } from "../../../src/protocol/acp-v2";
import { RuntimeHost } from "../../../src/runtime";
import { InMemoryProductSessionPersistence } from "../../../src/sessions";

describe("Runtime Host ACP client launcher", () => {
	test("delegates a packaged Runtime Host launch without importing its host adapter", async () => {
		const launches: { readonly entrypoint: string; readonly environment: Readonly<Record<string, string | undefined>> }[] = [];
		const client = await connectJaiRuntimeHost({
			dataDirectory: "/tmp/jai-runtime-host",
			endpoint: "/tmp/jai-runtime-host.sock",
			environment: { JAI_VERSION: "test" },
			runtimeHostEntrypoint: "/Applications/JAI.app/Contents/Resources/dist/main.js",
			launchRuntimeHost: (launch) => launches.push(launch),
			retryCount: 0,
		});
		expect(client.isErr()).toBe(true);
		expect(launches).toEqual([{
			entrypoint: "/Applications/JAI.app/Contents/Resources/dist/main.js",
			environment: {
				JAI_VERSION: "test",
				JAI_HOME: "/tmp/jai-runtime-host",
				JAI_RUNTIME_ENDPOINT: "/tmp/jai-runtime-host.sock",
			},
		}]);
	});

	test("joins an existing local Host without a model environment or a SQLite dependency", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-acp-launcher-"));
		const endpoint = join(directory, "runtime.sock");
		const opened = await openLocalAcpV2Server({
			endpoint,
			host: new RuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
			info: { name: "jai", version: "0.0.0" },
		});
		if (opened.isErr()) throw opened.error;
		try {
			const client = await connectJaiRuntimeHost({ endpoint, environment: {} });
			expect(client.isOk()).toBe(true);
			if (client.isErr()) throw client.error;
			const initialized = await client.value.request("initialize", {
				protocolVersion: 2,
				capabilities: {},
				info: { name: "test", version: "1.0.0" },
			});
			expect(initialized.isOk()).toBe(true);
			await client.value.close();
		} finally {
			await opened.value.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("waits for a cold-started Runtime Host beyond the previous three-second window", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-acp-cold-start-"));
		const endpoint = join(directory, "runtime.sock");
		let opened: Awaited<ReturnType<typeof openLocalAcpV2Server>> | undefined;
		let hostReady: Promise<void> | undefined;
		try {
			const client = await connectJaiRuntimeHost({
				dataDirectory: directory,
				endpoint,
				environment: {},
				runtimeHostEntrypoint: join(directory, "main.js"),
				launchRuntimeHost: () => {
					hostReady = new Promise((resolve) => {
						setTimeout(() => {
							void openLocalAcpV2Server({
								endpoint,
								host: new RuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
								info: { name: "jai", version: "0.0.0" },
							}).then((server) => {
								opened = server;
								resolve();
							});
						}, 3_200);
					});
				},
			});
			expect(client.isOk()).toBe(true);
			if (client.isOk()) await client.value.close();
		} finally {
			await hostReady;
			if (opened?.isOk()) await opened.value.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("treats a Host lock older than the current entrypoint as stale", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-acp-stale-"));
		const entrypoint = join(directory, "main.js");
		const lockPath = join(directory, "runtime-host.lock");
		try {
			await writeFile(entrypoint, "");
			await writeFile(lockPath, JSON.stringify({ pid: 1, createdAt: new Date(Date.now() - 60_000).toISOString() }));
			await utimes(entrypoint, new Date(), new Date());
			expect(await isLocalRuntimeHostStale(lockPath, entrypoint)).toBe(true);
			await writeFile(lockPath, JSON.stringify({ pid: 1, createdAt: new Date(Date.now() + 60_000).toISOString() }));
			expect(await isLocalRuntimeHostStale(lockPath, entrypoint)).toBe(false);
			expect(await isLocalRuntimeHostStale(join(directory, "missing.lock"), entrypoint)).toBe(false);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("replaces a connected Host when the on-disk entrypoint is newer than the lock", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-acp-replace-"));
		const endpoint = join(directory, "runtime.sock");
		const entrypoint = join(directory, "main.js");
		const lockPath = join(directory, "runtime-host.lock");
		const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
		const opened = await openLocalAcpV2Server({
			endpoint,
			host: new RuntimeHost({ persistence: new InMemoryProductSessionPersistence() }),
			info: { name: "jai", version: "0.0.0" },
		});
		if (opened.isErr()) throw opened.error;
		const launches: string[] = [];
		try {
			await writeFile(entrypoint, "");
			await writeFile(
				lockPath,
				JSON.stringify({ pid: holder.pid, createdAt: new Date(Date.now() - 60_000).toISOString() }),
			);
			await utimes(entrypoint, new Date(), new Date());
			const client = await connectJaiRuntimeHost({
				dataDirectory: directory,
				endpoint,
				environment: {},
				runtimeHostEntrypoint: entrypoint,
				launchRuntimeHost: (launch) => launches.push(launch.entrypoint),
				retryCount: 0,
			});
			expect(client.isErr()).toBe(true);
			expect(launches).toEqual([entrypoint]);
			expect(isHolderAlive(holder.pid)).toBe(false);
		} finally {
			holder.kill("SIGKILL");
			await opened.value.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("stopLocalRuntimeHost kills the lock holder and removes the lock", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-acp-stop-"));
		const lockPath = join(directory, "runtime-host.lock");
		const endpoint = join(directory, "runtime.sock");
		const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
		try {
			await writeFile(lockPath, JSON.stringify({ pid: holder.pid, createdAt: new Date().toISOString() }));
			await stopLocalRuntimeHost(lockPath, endpoint);
			expect(isHolderAlive(holder.pid)).toBe(false);
		} finally {
			holder.kill("SIGKILL");
			await rm(directory, { recursive: true, force: true });
		}
	});
});

function isHolderAlive(pid: number | undefined): boolean {
	if (pid === undefined) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
