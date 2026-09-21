import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createSafeShellEnvironment, SandboxedNodeExecutionEnvironment } from "../../../src/node/environment";
import { isSandboxStartupFailure } from "../../../src/harness/node/sandbox-environment";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string, parentDirectory = tmpdir()): Promise<string> {
	const directory = await mkdtemp(join(parentDirectory, prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function shellLiteral(value: string): string {
	return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

async function expectErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
	try {
		await promise;
		throw new Error(`Expected ${code}`);
	} catch (error) {
		expect(typeof error === "object" && error !== null && "_tag" in error ? error._tag : undefined).toBe(code);
	}
}

function createPolicy(workspace: string, deniedReadPaths: readonly string[] = [], deniedWritePaths: readonly string[] = []) {
	return {
		version: "sandbox-test",
		workspaceRoot: workspace,
		writableRoots: [workspace],
		deniedReadPaths,
		deniedWritePaths,
		environment: createSafeShellEnvironment(),
	};
}

function closeServer(server: { close(callback: (error?: Error) => void): unknown }): Promise<void> {
	return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe.skipIf(process.platform !== "darwin" && process.platform !== "linux")("SandboxedNodeExecutionEnvironment", () => {
	test("turns known Linux sandbox bootstrap failures into unavailable backend errors", () => {
		expect(isSandboxStartupFailure("apply-seccomp: write /proc/self/setgroups: Permission denied")).toBe(true);
		expect(isSandboxStartupFailure("bwrap: Creating new namespace failed: Operation not permitted")).toBe(true);
		expect(isSandboxStartupFailure("command failed with exit code 1")).toBe(false);
	});

	test("enforces filesystem and network policy for the complete Shell process tree", async () => {
		const workspace = await temporaryDirectory("jai-sandbox-workspace-");
		const outside = await temporaryDirectory(".jai-sandbox-outside-", homedir());
		const writeOutside = await temporaryDirectory(".jai-sandbox-write-outside-", homedir());
		const secret = join(outside, "secret.txt");
		const symlinkedSecret = join(workspace, "secret-link.txt");
		const lateDirectory = join(outside, "late");
		const movedSecret = join(outside, "moved-secret.txt");
		const escapedWrite = join(writeOutside, "escaped.txt");
		const permittedWrite = join(workspace, "permitted.txt");
		await writeFile(secret, "host-secret");
		await symlink(secret, symlinkedSecret);
		const environment = new SandboxedNodeExecutionEnvironment({ cwd: workspace });
		const policy = createPolicy(workspace, [outside], [writeOutside]);
		const run = (command: string) =>
			environment.withExecutionPolicy(policy, () =>
				environment.execute(command, { cwd: workspace, timeoutMs: 5_000 }),
			);

		expect((await run(`printf permitted > ${shellLiteral(permittedWrite)}`)).exitCode).toBe(0);
		expect(await readFile(permittedWrite, "utf8")).toBe("permitted");
		expect((await run(`/bin/sh -c ${shellLiteral(`/bin/cat ${shellLiteral(secret)}`)}`)).exitCode).not.toBe(0);
		expect((await run(`/bin/cat ${shellLiteral(symlinkedSecret)}`)).exitCode).not.toBe(0);
		expect(
			(await run(`node -e ${shellLiteral(`require("node:fs").readFileSync(${JSON.stringify(secret)})`)}`)).exitCode,
		).not.toBe(0);
		expect((await run(`printf escaped > ${shellLiteral(escapedWrite)}`)).exitCode).not.toBe(0);
		await mkdir(lateDirectory);
		await writeFile(join(lateDirectory, "created-after-policy.txt"), "late-secret");
		expect((await run(`/bin/cat ${shellLiteral(join(lateDirectory, "created-after-policy.txt"))}`)).exitCode).not.toBe(0);
		await rename(secret, movedSecret);
		expect((await run(`/bin/cat ${shellLiteral(movedSecret)}`)).exitCode).not.toBe(0);

		const server = createHttpServer((_request, response) => response.end("unexpected network access"));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Could not start the network test server");
			const network = await run(`curl --noproxy '*' --connect-timeout 1 http://127.0.0.1:${address.port}/`);
			expect(network.exitCode).not.toBe(0);
		} finally {
			await closeServer(server);
		}
	});

	test("does not share opposite concurrent policies between Sessions", async () => {
		const workspace = await temporaryDirectory("jai-sandbox-isolation-");
		const secret = join(workspace, "secret.txt");
		await writeFile(secret, "session-specific-secret");
		const restrictive = new SandboxedNodeExecutionEnvironment({ cwd: workspace });
		const permissive = new SandboxedNodeExecutionEnvironment({ cwd: workspace });
		const [denied, allowed] = await Promise.all([
			restrictive.withExecutionPolicy(createPolicy(workspace, [secret]), () =>
				restrictive.execute(`/bin/cat ${shellLiteral(secret)}`, { cwd: workspace, timeoutMs: 5_000 }),
			),
			permissive.withExecutionPolicy(createPolicy(workspace), () =>
				permissive.execute(`/bin/cat ${shellLiteral(secret)}`, { cwd: workspace, timeoutMs: 5_000 }),
			),
		]);
		expect(denied.exitCode).not.toBe(0);
		expect(allowed.exitCode).toBe(0);
	});

	test("blocks direct IPv4, IPv6, UDP and Unix-socket traffic by default", async () => {
		const workspace = await temporaryDirectory("jai-sandbox-network-");
		const environment = new SandboxedNodeExecutionEnvironment({ cwd: workspace });
		const policy = createPolicy(workspace);
		const run = (command: string) =>
			environment.withExecutionPolicy(policy, () =>
				environment.execute(command, { cwd: workspace, timeoutMs: 5_000 }),
			);
		const ipv4 = createHttpServer((_request, response) => response.end("unexpected"));
		const ipv6 = createHttpServer((_request, response) => response.end("unexpected"));
		const socketPath = join(workspace, "network.sock");
		const unixSocket = createSocketServer((socket) => socket.end("unexpected"));
		await new Promise<void>((resolve) => ipv4.listen(0, "127.0.0.1", resolve));
		await new Promise<void>((resolve) => ipv6.listen(0, "::1", resolve));
		await new Promise<void>((resolve) => unixSocket.listen(socketPath, resolve));
		try {
			const ipv4Address = ipv4.address();
			const ipv6Address = ipv6.address();
			if (!ipv4Address || typeof ipv4Address === "string" || !ipv6Address || typeof ipv6Address === "string") {
				throw new Error("Could not start loopback test servers");
			}
			expect((await run(`curl --noproxy '*' --connect-timeout 1 http://127.0.0.1:${ipv4Address.port}/`)).exitCode).not.toBe(0);
			expect((await run(`curl --noproxy '*' --connect-timeout 1 http://[::1]:${ipv6Address.port}/`)).exitCode).not.toBe(0);
			expect(
				(
					await run(
						`node -e ${shellLiteral(`const socket = require("node:dgram").createSocket("udp4"); socket.on("error", () => process.exit(1)); socket.send("x", 9, "127.0.0.1", () => socket.close()); setTimeout(() => process.exit(0), 250);`)}`,
					)
				).exitCode,
			).not.toBe(0);
			expect(
				(
					await run(
						`node -e ${shellLiteral(`require("node:net").createConnection(${JSON.stringify(socketPath)}).on("connect", () => process.exit(0)).on("error", () => process.exit(1));`)}`,
					)
				).exitCode,
			).not.toBe(0);
		} finally {
			await Promise.all([closeServer(ipv4), closeServer(ipv6), closeServer(unixSocket)]);
		}
	});

	test("cancels live process trees when a replacement policy arrives", async () => {
		const workspace = await temporaryDirectory("jai-sandbox-cancel-");
		const environment = new SandboxedNodeExecutionEnvironment({ cwd: workspace });
		const policy = { ...createPolicy(workspace), version: "before-config-tightening" };
		const running = environment.withExecutionPolicy(policy, () =>
			environment.execute("sleep 10", { cwd: workspace, timeoutMs: 15_000 }),
		);
		await Bun.sleep(50);
		environment.cancelActivePolicies();
		await expectErrorCode(running, "shell.aborted");
	});

	test("refuses a custom Shell instead of falling back outside the sandbox", async () => {
		const workspace = await temporaryDirectory("jai-sandbox-shell-");
		expect(() => new SandboxedNodeExecutionEnvironment({ cwd: workspace, shellPath: "/bin/zsh" })).toThrow(
			"custom Shell path",
		);
		const environment = new SandboxedNodeExecutionEnvironment({ cwd: workspace });
		const policy = { ...createPolicy(workspace), version: "custom-shell" };
		await expect(
			environment.withExecutionPolicy(policy, () =>
				environment.execute("true", { cwd: workspace, timeoutMs: 1_000, shell: "/bin/zsh" }),
			),
		).rejects.toThrow("custom Shell path");
	});
});
