import { randomUUID } from "node:crypto";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { DesktopTerminalEvent, DesktopTerminalSnapshot } from "../../shared/desktop-rpc";
import { mainLog } from "../logger";

const HISTORY_CHARACTER_LIMIT = 262_144;
const OUTPUT_HIGH_WATERMARK = 1_048_576;
const OUTPUT_LOW_WATERMARK = 65_536;
const PROCESS_EXIT_GRACE_MS = 750;

export class TerminalWorkspaceUnavailable extends TaggedError("desktop_terminal.workspace_unavailable")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class TerminalNotFound extends TaggedError("desktop_terminal.not_found")<{
	readonly message: string;
}> {}

export class TerminalSpawnFailed extends TaggedError("desktop_terminal.spawn_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class TerminalOperationFailed extends TaggedError("desktop_terminal.operation_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type TerminalError =
	| TerminalWorkspaceUnavailable
	| TerminalNotFound
	| TerminalSpawnFailed
	| TerminalOperationFailed;

export interface PtyProcess {
	readonly pid: number;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	pause(): void;
	resume(): void;
	kill(signal?: string): void;
	onData(listener: (data: string) => void): () => void;
	onExit(listener: (event: { readonly exitCode: number; readonly signal?: number }) => void): () => void;
}

export interface PtyAdapter {
	spawn(input: {
		readonly shell: string;
		readonly args: readonly string[];
		readonly cwd: string;
		readonly cols: number;
		readonly rows: number;
		readonly env: Record<string, string>;
	}): Promise<PtyProcess>;
}

interface TerminalSession {
	readonly sessionId: string;
	readonly terminalId: string;
	readonly cwd: string;
	cols: number;
	rows: number;
	process: PtyProcess | null;
	status: DesktopTerminalSnapshot["status"];
	history: string;
	exitCode: number | null;
	pendingBytes: number;
	paused: boolean;
	readonly consumers: Set<number>;
	disposeData?: () => void;
	disposeExit?: () => void;
}

export interface TerminalRegistryDependencies {
	readonly pty: PtyAdapter;
	readonly resolveSessionCwd: (sessionId: string) => Promise<string | undefined>;
	readonly publish: (event: DesktopTerminalEvent) => void;
	readonly createId?: () => string;
	readonly environment?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform;
}

export class TerminalRegistry {
	readonly #sessions = new Map<string, TerminalSession>();
	readonly #pty: PtyAdapter;
	readonly #resolveSessionCwd: TerminalRegistryDependencies["resolveSessionCwd"];
	readonly #publish: TerminalRegistryDependencies["publish"];
	readonly #createId: () => string;
	readonly #environment: NodeJS.ProcessEnv;
	readonly #platform: NodeJS.Platform;

	constructor(dependencies: TerminalRegistryDependencies) {
		this.#pty = dependencies.pty;
		this.#resolveSessionCwd = dependencies.resolveSessionCwd;
		this.#publish = dependencies.publish;
		this.#createId = dependencies.createId ?? randomUUID;
		this.#environment = dependencies.environment ?? process.env;
		this.#platform = dependencies.platform ?? process.platform;
	}

	attach(sessionId: string, consumerId: number): readonly DesktopTerminalSnapshot[] {
		const snapshots: DesktopTerminalSnapshot[] = [];
		for (const terminal of this.#sessions.values()) {
			if (terminal.sessionId !== sessionId) continue;
			terminal.consumers.add(consumerId);
			terminal.pendingBytes = 0;
			this.#resume(terminal);
			snapshots.push(this.#snapshot(terminal));
		}
		return snapshots;
	}

	detach(sessionId: string, consumerId: number): void {
		for (const terminal of this.#sessions.values()) {
			if (terminal.sessionId !== sessionId) continue;
			terminal.consumers.delete(consumerId);
			terminal.pendingBytes = 0;
			this.#resume(terminal);
		}
	}

	detachConsumer(consumerId: number): void {
		for (const terminal of this.#sessions.values()) {
			terminal.consumers.delete(consumerId);
			if (terminal.consumers.size === 0) {
				terminal.pendingBytes = 0;
				this.#resume(terminal);
			}
		}
	}

	async open(
		sessionId: string,
		consumerId: number,
		cols: number,
		rows: number,
	): Promise<ResultType<DesktopTerminalSnapshot, TerminalError>> {
		const cwd = await this.#resolveSessionCwd(sessionId).catch(() => undefined);
		if (!cwd) {
			return Result.err(new TerminalWorkspaceUnavailable({ message: "Session workspace is unavailable." }));
		}
		const terminal: TerminalSession = {
			sessionId,
			terminalId: this.#createId(),
			cwd,
			cols,
			rows,
			process: null,
			status: "running",
			history: "",
			exitCode: null,
			pendingBytes: 0,
			paused: false,
			consumers: new Set([consumerId]),
		};
		const started = await this.#start(terminal);
		if (started.isErr()) return started;
		this.#sessions.set(this.#key(sessionId, terminal.terminalId), terminal);
		return Result.ok(this.#snapshot(terminal));
	}

	write(sessionId: string, terminalId: string, data: string): ResultType<void, TerminalError> {
		return this.#withRunning(sessionId, terminalId, (terminal) => terminal.process!.write(data));
	}

	ack(sessionId: string, terminalId: string, bytes: number): ResultType<void, TerminalError> {
		const terminal = this.#sessions.get(this.#key(sessionId, terminalId));
		if (!terminal) return Result.err(new TerminalNotFound({ message: "Terminal does not exist." }));
		terminal.pendingBytes = Math.max(0, terminal.pendingBytes - bytes);
		if (terminal.pendingBytes <= OUTPUT_LOW_WATERMARK) this.#resume(terminal);
		return Result.ok(undefined);
	}

	resize(sessionId: string, terminalId: string, cols: number, rows: number): ResultType<void, TerminalError> {
		return this.#withRunning(sessionId, terminalId, (terminal) => {
			terminal.process!.resize(cols, rows);
			terminal.cols = cols;
			terminal.rows = rows;
		});
	}

	clear(sessionId: string, terminalId: string): ResultType<void, TerminalError> {
		const terminal = this.#sessions.get(this.#key(sessionId, terminalId));
		if (!terminal) return Result.err(new TerminalNotFound({ message: "Terminal does not exist." }));
		terminal.history = "";
		this.#publish({ type: "cleared", sessionId, terminalId });
		return Result.ok(undefined);
	}

	async restart(
		sessionId: string,
		terminalId: string,
		cols: number,
		rows: number,
	): Promise<ResultType<DesktopTerminalSnapshot, TerminalError>> {
		const terminal = this.#sessions.get(this.#key(sessionId, terminalId));
		if (!terminal) return Result.err(new TerminalNotFound({ message: "Terminal does not exist." }));
		await this.#stop(terminal);
		terminal.cols = cols;
		terminal.rows = rows;
		terminal.history = "";
		terminal.exitCode = null;
		terminal.status = "running";
		terminal.pendingBytes = 0;
		const started = await this.#start(terminal);
		if (started.isErr()) return started;
		const snapshot = this.#snapshot(terminal);
		this.#publish({ type: "restarted", snapshot });
		return Result.ok(snapshot);
	}

	async close(sessionId: string, terminalId: string): Promise<ResultType<void, TerminalError>> {
		const key = this.#key(sessionId, terminalId);
		const terminal = this.#sessions.get(key);
		if (!terminal) return Result.err(new TerminalNotFound({ message: "Terminal does not exist." }));
		this.#sessions.delete(key);
		await this.#stop(terminal);
		return Result.ok(undefined);
	}

	async closeSession(sessionId: string): Promise<void> {
		const terminals = [...this.#sessions.values()].filter((terminal) => terminal.sessionId === sessionId);
		for (const terminal of terminals) this.#sessions.delete(this.#key(sessionId, terminal.terminalId));
		await Promise.all(terminals.map((terminal) => this.#stop(terminal)));
	}

	async closeAll(): Promise<void> {
		const terminals = [...this.#sessions.values()];
		this.#sessions.clear();
		await Promise.all(terminals.map((terminal) => this.#stop(terminal)));
	}

	async #start(terminal: TerminalSession): Promise<ResultType<void, TerminalError>> {
		const shell = resolveShell(this.#environment, this.#platform);
		const spawned = await Result.tryPromise({
			try: () =>
				this.#pty.spawn({
					shell,
					args: this.#platform === "win32" ? [] : ["-l"],
					cwd: terminal.cwd,
					cols: terminal.cols,
					rows: terminal.rows,
					env: terminalEnvironment(this.#environment, this.#platform),
				}),
			catch: (cause) => new TerminalSpawnFailed({ message: "Terminal process could not be started.", cause }),
		});
		if (spawned.isErr()) {
			mainLog.error("Desktop Terminal PTY spawn failed:", spawned.error.cause);
			terminal.status = "error";
			return spawned;
		}
		terminal.process = spawned.value;
		terminal.disposeData = spawned.value.onData((data) => this.#onData(terminal, data));
		terminal.disposeExit = spawned.value.onExit(({ exitCode }) => {
			terminal.process = null;
			terminal.status = "exited";
			terminal.exitCode = exitCode;
			terminal.disposeData?.();
			terminal.disposeData = undefined;
			terminal.disposeExit = undefined;
			this.#publish({
				type: "status",
				sessionId: terminal.sessionId,
				terminalId: terminal.terminalId,
				status: "exited",
				exitCode,
			});
		});
		return Result.ok(undefined);
	}

	async #stop(terminal: TerminalSession): Promise<void> {
		const ptyProcess = terminal.process;
		terminal.process = null;
		terminal.disposeData?.();
		terminal.disposeExit?.();
		terminal.disposeData = undefined;
		terminal.disposeExit = undefined;
		if (!ptyProcess) return;
		let resolveExit = () => {};
		const exited = new Promise<void>((resolve) => {
			resolveExit = resolve;
		});
		const disposeWaiter = ptyProcess.onExit(() => {
			resolveExit();
		});
		try {
			ptyProcess.kill("SIGTERM");
		} catch {
			// The process may have exited between the state check and kill.
		}
		const stopped = await Promise.race([
			exited.then(() => true),
			new Promise<false>((resolve) => setTimeout(() => resolve(false), PROCESS_EXIT_GRACE_MS)),
		]);
		if (!stopped) {
			try {
				ptyProcess.kill("SIGKILL");
			} catch {
				// The grace period may have ended just after the process exited.
			}
			await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 250))]);
		}
		disposeWaiter();
	}

	#onData(terminal: TerminalSession, data: string): void {
		terminal.history = `${terminal.history}${data}`.slice(-HISTORY_CHARACTER_LIMIT);
		if (terminal.consumers.size === 0) return;
		const bytes = Buffer.byteLength(data);
		terminal.pendingBytes += bytes;
		this.#publish({ type: "output", sessionId: terminal.sessionId, terminalId: terminal.terminalId, data, bytes });
		if (terminal.pendingBytes >= OUTPUT_HIGH_WATERMARK && !terminal.paused && terminal.process) {
			terminal.process.pause();
			terminal.paused = true;
		}
	}

	#resume(terminal: TerminalSession): void {
		if (!terminal.paused || !terminal.process) return;
		terminal.process.resume();
		terminal.paused = false;
	}

	#withRunning(
		sessionId: string,
		terminalId: string,
		action: (terminal: TerminalSession) => void,
	): ResultType<void, TerminalError> {
		const terminal = this.#sessions.get(this.#key(sessionId, terminalId));
		if (!terminal) return Result.err(new TerminalNotFound({ message: "Terminal does not exist." }));
		if (!terminal.process || terminal.status !== "running") {
			return Result.err(new TerminalOperationFailed({ message: "Terminal is not running." }));
		}
		return Result.try({
			try: () => action(terminal),
			catch: (cause) => new TerminalOperationFailed({ message: "Terminal operation failed.", cause }),
		});
	}

	#snapshot(terminal: TerminalSession): DesktopTerminalSnapshot {
		return {
			sessionId: terminal.sessionId,
			terminalId: terminal.terminalId,
			cwd: terminal.cwd,
			cols: terminal.cols,
			rows: terminal.rows,
			status: terminal.status,
			pid: terminal.process?.pid ?? null,
			history: terminal.history,
			exitCode: terminal.exitCode,
		};
	}

	#key(sessionId: string, terminalId: string): string {
		return `${sessionId}\u0000${terminalId}`;
	}
}

export function resolveShell(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
	if (platform === "win32") return environment.ComSpec || "powershell.exe";
	return environment.SHELL || "/bin/zsh";
}

export function terminalEnvironment(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): Record<string, string> {
	const allowed = new Set([
		"HOME",
		"PATH",
		"SHELL",
		"USER",
		"LOGNAME",
		"LANG",
		"TMPDIR",
		"TMP",
		"TEMP",
		"SystemRoot",
		"ComSpec",
		"PATHEXT",
		"USERPROFILE",
		"HOMEDRIVE",
		"HOMEPATH",
		"APPDATA",
		"LOCALAPPDATA",
	]);
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(environment)) {
		if (typeof value === "string" && (allowed.has(key) || key.startsWith("LC_"))) result[key] = value;
	}
	result.TERM = platform === "win32" ? "xterm-color" : "xterm-256color";
	result.COLORTERM = "truecolor";
	result.TERM_PROGRAM = "PandaWork";
	return result;
}
