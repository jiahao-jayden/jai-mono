import { connectJaiRuntimeHost } from "@jai/server/acp-client";
import { mainLog } from "../logger";
import {
	createDesktopRuntimeHostLauncher,
	type DesktopRuntimeHostLauncher,
	type DesktopRuntimeHostProcess,
	resolveDesktopRuntimeHostEntrypoint,
} from "./entrypoint";

const DEFAULT_MAX_RESTART_ATTEMPTS = 3;
const DEFAULT_BASE_RESTART_DELAY_MS = 250;
const STABLE_PROCESS_MS = 10_000;

export interface DesktopRuntimeHostSupervisorOptions {
	readonly runtimeHostEntrypoint?: string;
	readonly launcher?: DesktopRuntimeHostLauncher;
	readonly maxRestartAttempts?: number;
	readonly baseRestartDelayMs?: number;
}

export class DesktopRuntimeHostSupervisor {
	readonly #runtimeHostEntrypoint: string | undefined;
	readonly #launcher: DesktopRuntimeHostLauncher | undefined;
	readonly #maxRestartAttempts: number;
	readonly #baseRestartDelayMs: number;
	#process: DesktopRuntimeHostProcess | undefined;
	#removeExitListener: (() => void) | undefined;
	#removeErrorListener: (() => void) | undefined;
	#removeStderrListener: (() => void) | undefined;
	#restartTimer: ReturnType<typeof setTimeout> | undefined;
	#stableTimer: ReturnType<typeof setTimeout> | undefined;
	#lastLaunch: Parameters<DesktopRuntimeHostLauncher>[0] | undefined;
	#restartAttempts = 0;
	#closed = false;

	constructor(options: DesktopRuntimeHostSupervisorOptions = {}) {
		this.#runtimeHostEntrypoint = options.runtimeHostEntrypoint ?? resolveDesktopRuntimeHostEntrypoint();
		this.#launcher = options.launcher ?? createDesktopRuntimeHostLauncher();
		this.#maxRestartAttempts = options.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS;
		this.#baseRestartDelayMs = options.baseRestartDelayMs ?? DEFAULT_BASE_RESTART_DELAY_MS;
	}

	get runtimeHostEntrypoint(): string | undefined {
		return this.#runtimeHostEntrypoint;
	}

	launchRuntimeHost(input: Parameters<DesktopRuntimeHostLauncher>[0]): DesktopRuntimeHostProcess | undefined {
		return this.#launch(input);
	}

	async connect(): Promise<Awaited<ReturnType<typeof connectJaiRuntimeHost>>> {
		if (this.#closed) {
			throw new Error("Runtime Host Supervisor is closed");
		}
		return connectJaiRuntimeHost({
			runtimeHostEntrypoint: this.#runtimeHostEntrypoint,
			launchRuntimeHost: this.#launcher === undefined ? undefined : (input) => this.#launch(input),
		});
	}

	async retry(): Promise<Awaited<ReturnType<typeof connectJaiRuntimeHost>>> {
		this.#restartAttempts = 0;
		return this.connect();
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		if (this.#restartTimer) clearTimeout(this.#restartTimer);
		if (this.#stableTimer) clearTimeout(this.#stableTimer);
		this.#restartTimer = undefined;
		this.#stableTimer = undefined;
		this.#removeExitListener?.();
		this.#removeErrorListener?.();
		this.#removeStderrListener?.();
		this.#removeExitListener = undefined;
		this.#removeErrorListener = undefined;
		this.#removeStderrListener = undefined;
		const process = this.#process;
		this.#process = undefined;
		if (process) {
			process.kill();
			await process.waitForExit();
		}
	}

	#launch(input: Parameters<DesktopRuntimeHostLauncher>[0]): DesktopRuntimeHostProcess | undefined {
		this.#lastLaunch = input;
		if (this.#closed || this.#restartTimer || !this.#launcher) return undefined;
		if (this.#process) return this.#process;
		const process = this.#launcher(input);
		this.#process = process;
		this.#removeExitListener = process.onExit((code, signal) => this.#onExit(code, signal));
		this.#removeErrorListener = process.onError((error) => {
			mainLog.error("Runtime Host process error:", error);
		});
		this.#removeStderrListener = subscribeStderr(process, (chunk) => {
			const message = chunk.trim();
			if (message) mainLog.warn("Runtime Host stderr:", message);
		});
		this.#stableTimer = setTimeout(() => {
			this.#restartAttempts = 0;
			this.#stableTimer = undefined;
		}, STABLE_PROCESS_MS);
		return process;
	}

	#onExit(code: number | null, signal: string | null): void {
		this.#process = undefined;
		this.#removeExitListener = undefined;
		this.#removeErrorListener?.();
		this.#removeStderrListener?.();
		this.#removeErrorListener = undefined;
		this.#removeStderrListener = undefined;
		if (this.#stableTimer) clearTimeout(this.#stableTimer);
		this.#stableTimer = undefined;
		if (this.#closed) return;
		if (this.#restartAttempts >= this.#maxRestartAttempts) {
			mainLog.error(
				`Runtime Host exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}; restart budget exhausted`,
			);
			return;
		}
		const attempt = this.#restartAttempts + 1;
		this.#restartAttempts = attempt;
		const delay = this.#baseRestartDelayMs * 2 ** (attempt - 1);
		this.#restartTimer = setTimeout(() => {
			this.#restartTimer = undefined;
			if (this.#lastLaunch) this.#launch(this.#lastLaunch);
		}, delay);
	}
}

function subscribeStderr(process: DesktopRuntimeHostProcess, listener: (message: string) => void): () => void {
	const stderr = process.stderr;
	if (!stderr || typeof stderr.on !== "function") return () => {};
	const onData = (chunk: unknown): void => listener(String(chunk));
	stderr.on("data", onData);
	return () => stderr.off?.("data", onData);
}
