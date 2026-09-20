import { describe, expect, test } from "bun:test";
import type { DesktopTerminalEvent } from "../shared/desktop-rpc";
import {
	TerminalRegistry,
	type PtyAdapter,
	type PtyProcess,
	resolveShell,
	terminalEnvironment,
} from "../electron/terminal";

describe("TerminalRegistry", () => {
	test("opens multiple stable terminals in the Session cwd with a filtered environment", async () => {
		const fixture = terminalFixture();
		const first = await fixture.registry.open("session-1", 7, 120, 30);
		const second = await fixture.registry.open("session-1", 7, 80, 24);

		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		if (first.isErr() || second.isErr()) return;
		expect(first.value.terminalId).toBe("terminal-1");
		expect(second.value.terminalId).toBe("terminal-2");
		expect(fixture.adapter.spawnInputs.map((input) => input.cwd)).toEqual(["/workspace/session-1", "/workspace/session-1"]);
		expect(fixture.adapter.spawnInputs[0]?.env).toMatchObject({
			HOME: "/Users/test",
			PATH: "/usr/bin",
			TERM: "xterm-256color",
			TERM_PROGRAM: "PandaWork",
		});
		expect(fixture.adapter.spawnInputs[0]?.env.OPENAI_API_KEY).toBeUndefined();
	});

	test("writes, resizes, clears, exits and restarts through the same terminal id", async () => {
		const fixture = terminalFixture();
		const opened = await fixture.registry.open("session-1", 7, 120, 30);
		if (opened.isErr()) throw opened.error;
		const process = fixture.adapter.processes[0]!;

		expect(fixture.registry.write("session-1", opened.value.terminalId, "printf ok\r").isOk()).toBe(true);
		expect(fixture.registry.resize("session-1", opened.value.terminalId, 90, 20).isOk()).toBe(true);
		process.emitData("ok\r\n");
		expect(fixture.registry.clear("session-1", opened.value.terminalId).isOk()).toBe(true);
		process.emitExit(2);
		expect(fixture.registry.write("session-1", opened.value.terminalId, "pwd\r").isErr()).toBe(true);

		const restarted = await fixture.registry.restart("session-1", opened.value.terminalId, 100, 25);
		expect(restarted.isOk()).toBe(true);
		if (restarted.isErr()) return;
		expect(restarted.value.terminalId).toBe(opened.value.terminalId);
		expect(restarted.value.status).toBe("running");
		expect(process.writes).toEqual(["printf ok\r"]);
		expect(process.sizes).toEqual([[90, 20]]);
		expect(fixture.events.map((event) => event.type)).toEqual(["output", "cleared", "status", "restarted"]);
	});

	test("keeps hidden output bounded and applies ACK flow control only while attached", async () => {
		const fixture = terminalFixture();
		const opened = await fixture.registry.open("session-1", 7, 120, 30);
		if (opened.isErr()) throw opened.error;
		const process = fixture.adapter.processes[0]!;
		const chunk = "x".repeat(1_100_000);

		fixture.registry.detach("session-1", 7);
		process.emitData(chunk);
		expect(process.pauseCount).toBe(0);
		expect(fixture.registry.attach("session-1", 7)[0]?.history.length).toBe(262_144);

		process.emitData(chunk);
		expect(process.pauseCount).toBe(1);
		expect(fixture.registry.ack("session-1", opened.value.terminalId, 1_100_000).isOk()).toBe(true);
		expect(process.resumeCount).toBe(1);
	});

	test("closing one Session reaps only its PTYs and closeAll reaps the remainder", async () => {
		const fixture = terminalFixture({ exitOnTerminate: true });
		await fixture.registry.open("session-1", 7, 120, 30);
		await fixture.registry.open("session-1", 7, 120, 30);
		await fixture.registry.open("session-2", 7, 120, 30);

		await fixture.registry.closeSession("session-1");
		expect(fixture.adapter.processes.map((process) => process.kills)).toEqual([["SIGTERM"], ["SIGTERM"], []]);
		expect(fixture.registry.attach("session-1", 7)).toEqual([]);
		expect(fixture.registry.attach("session-2", 7)).toHaveLength(1);

		await fixture.registry.closeAll();
		expect(fixture.adapter.processes[2]?.kills).toEqual(["SIGTERM"]);
	});

	test("escalates close to SIGKILL when a PTY does not exit during the grace period", async () => {
		const fixture = terminalFixture();
		const opened = await fixture.registry.open("session-1", 7, 120, 30);
		if (opened.isErr()) throw opened.error;

		await fixture.registry.close("session-1", opened.value.terminalId);
		expect(fixture.adapter.processes[0]?.kills).toEqual(["SIGTERM", "SIGKILL"]);
	});

	test("returns tagged recoverable failures without creating a terminal", async () => {
		const unavailable = terminalFixture({ resolveSessionCwd: async () => undefined });
		const missingWorkspace = await unavailable.registry.open("session-1", 7, 120, 30);
		expect(missingWorkspace.isErr() && missingWorkspace.error._tag).toBe("desktop_terminal.workspace_unavailable");

		const failed = terminalFixture({ failSpawn: true });
		const spawnFailure = await failed.registry.open("session-1", 7, 120, 30);
		expect(spawnFailure.isErr() && spawnFailure.error._tag).toBe("desktop_terminal.spawn_failed");
		expect(failed.registry.attach("session-1", 7)).toEqual([]);
	});
});

test("terminal shell and environment defaults are platform-aware", () => {
	expect(resolveShell({ SHELL: "/bin/fish" }, "darwin")).toBe("/bin/fish");
	expect(resolveShell({ ComSpec: "cmd.exe" }, "win32")).toBe("cmd.exe");
	expect(
		terminalEnvironment({ PATH: "/bin", LC_ALL: "en_US.UTF-8", JAI_CONTROL_SOCKET: "secret" }, "linux"),
	).toEqual({
		PATH: "/bin",
		LC_ALL: "en_US.UTF-8",
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
		TERM_PROGRAM: "PandaWork",
	});
});

function terminalFixture(
	options: {
		readonly exitOnTerminate?: boolean;
		readonly failSpawn?: boolean;
		readonly resolveSessionCwd?: (sessionId: string) => Promise<string | undefined>;
	} = {},
) {
	const adapter = new FakePtyAdapter(options.exitOnTerminate ?? false, options.failSpawn ?? false);
	const events: DesktopTerminalEvent[] = [];
	let nextId = 0;
	const registry = new TerminalRegistry({
		pty: adapter,
		resolveSessionCwd: options.resolveSessionCwd ?? (async (sessionId) => `/workspace/${sessionId}`),
		publish: (event) => events.push(event),
		createId: () => `terminal-${++nextId}`,
		environment: { HOME: "/Users/test", PATH: "/usr/bin", SHELL: "/bin/zsh", OPENAI_API_KEY: "secret" },
		platform: "darwin",
	});
	return { adapter, events, registry };
}

class FakePtyAdapter implements PtyAdapter {
	readonly processes: FakePtyProcess[] = [];
	readonly spawnInputs: Parameters<PtyAdapter["spawn"]>[0][] = [];

	constructor(
		private readonly exitOnTerminate: boolean,
		private readonly failSpawn: boolean,
	) {}

	async spawn(input: Parameters<PtyAdapter["spawn"]>[0]): Promise<PtyProcess> {
		this.spawnInputs.push(input);
		if (this.failSpawn) throw new Error("spawn failed");
		const process = new FakePtyProcess(1000 + this.processes.length, this.exitOnTerminate);
		this.processes.push(process);
		return process;
	}
}

class FakePtyProcess implements PtyProcess {
	readonly writes: string[] = [];
	readonly sizes: [number, number][] = [];
	readonly kills: string[] = [];
	pauseCount = 0;
	resumeCount = 0;
	readonly #dataListeners = new Set<(data: string) => void>();
	readonly #exitListeners = new Set<(event: { readonly exitCode: number; readonly signal?: number }) => void>();

	constructor(
		readonly pid: number,
		private readonly exitOnTerminate: boolean,
	) {}

	write(data: string): void {
		this.writes.push(data);
	}

	resize(cols: number, rows: number): void {
		this.sizes.push([cols, rows]);
	}

	pause(): void {
		this.pauseCount += 1;
	}

	resume(): void {
		this.resumeCount += 1;
	}

	kill(signal = "SIGTERM"): void {
		this.kills.push(signal);
		if (this.exitOnTerminate) this.emitExit(0);
	}

	onData(listener: (data: string) => void): () => void {
		this.#dataListeners.add(listener);
		return () => this.#dataListeners.delete(listener);
	}

	onExit(listener: (event: { readonly exitCode: number; readonly signal?: number }) => void): () => void {
		this.#exitListeners.add(listener);
		return () => this.#exitListeners.delete(listener);
	}

	emitData(data: string): void {
		for (const listener of this.#dataListeners) listener(data);
	}

	emitExit(exitCode: number): void {
		for (const listener of [...this.#exitListeners]) listener({ exitCode, signal: 0 });
	}
}
