import { join } from "node:path";
import { inspect } from "node:util";
import { appendRotatingTextFile } from "@jai/telemetry/node";
import { redactSecrets } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Readonly<Record<string, unknown>>;

export interface HostLogTextOutput {
	write(text: string): void;
}

export interface HostLogOptions {
	readonly dataDirectory: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	/** 省略时写到进程 stderr。传 null 表示不附加 stderr。 */
	readonly stderr?: HostLogTextOutput | null;
}

/**
 * Runtime Host 的进程内诊断日志。写入 `<dataDirectory>/logs/runtime-host/host.log`，
 * 不拥有产品事实；写失败不会抛给调用方。
 */
export interface HostLog {
	debug(message: string, context?: LogContext): void;
	info(message: string, context?: LogContext): void;
	warn(message: string, context?: LogContext): void;
	error(message: string, context?: LogContext): void;
	scope(name: string): HostLog;
	close(): Promise<void>;
}

const LEVEL_RANK: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const HOST_LOG_MAX_BYTES = 10 * 1024 * 1024;
const HOST_LOG_MAX_FILES = 5;

const ANSI = {
	reset: "\u001b[0m",
	dim: "\u001b[2m",
	cyan: "\u001b[36m",
	yellow: "\u001b[33m",
	red: "\u001b[31m",
	magenta: "\u001b[35m",
} as const;

const LEVEL_LABEL: Record<LogLevel, string> = {
	debug: "DEBUG",
	info: "INFO",
	warn: "WARN",
	error: "ERROR",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
	debug: ANSI.magenta,
	info: ANSI.cyan,
	warn: ANSI.yellow,
	error: ANSI.red,
};

export function openHostLog(options: HostLogOptions): HostLog {
	const sink = new HostLogSink(options);
	return new ScopedHostLog("runtime", sink);
}

class HostLogSink {
	readonly #path: string;
	readonly #minimum: LogLevel;
	readonly #stderr: HostLogTextOutput | null;
	readonly #colorStderr: boolean;
	#tail: Promise<void> = Promise.resolve();

	constructor(options: HostLogOptions) {
		this.#path = join(options.dataDirectory, "logs", "runtime-host", "host.log");
		this.#minimum = parseLogLevel(options.environment?.JAI_LOG_LEVEL);
		this.#stderr = options.stderr === null ? null : (options.stderr ?? process.stderr);
		this.#colorStderr = this.#stderr === process.stderr && shouldColorStderr();
	}

	write(level: LogLevel, scope: string, message: string, context?: LogContext): void {
		if (LEVEL_RANK[level] < LEVEL_RANK[this.#minimum]) return;
		const line = redactSecrets(formatLine(level, scope, message, context));
		const stderrLine = this.#colorStderr ? colorizeLine(level, line) : line;
		this.#tail = this.#tail
			.then(async () => {
				await appendRotatingTextFile(
					{ path: this.#path, maxBytes: HOST_LOG_MAX_BYTES, maxFiles: HOST_LOG_MAX_FILES },
					`${line}\n`,
				);
				this.#stderr?.write(`${stderrLine}\n`);
			})
			.catch(() => undefined);
	}

	close(): Promise<void> {
		const closed = this.#tail;
		this.#tail = closed.then(
			() => undefined,
			() => undefined,
		);
		return closed.then(
			() => undefined,
			() => undefined,
		);
	}
}

class ScopedHostLog implements HostLog {
	constructor(
		private readonly scopeName: string,
		private readonly sink: HostLogSink,
	) {}

	debug(message: string, context?: LogContext): void {
		this.sink.write("debug", this.scopeName, message, context);
	}

	info(message: string, context?: LogContext): void {
		this.sink.write("info", this.scopeName, message, context);
	}

	warn(message: string, context?: LogContext): void {
		this.sink.write("warn", this.scopeName, message, context);
	}

	error(message: string, context?: LogContext): void {
		this.sink.write("error", this.scopeName, message, context);
	}

	scope(name: string): HostLog {
		return new ScopedHostLog(name, this.sink);
	}

	close(): Promise<void> {
		return this.sink.close();
	}
}

function parseLogLevel(value: string | undefined): LogLevel {
	if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
	return "info";
}

function formatLine(level: LogLevel, scope: string, message: string, context: LogContext | undefined): string {
	const contextText = formatContext(context);
	return `${new Date().toISOString()} ${LEVEL_LABEL[level]} [${scope}] ${message}${contextText}`;
}

function formatContext(context: LogContext | undefined): string {
	if (!context) return "";
	const parts: string[] = [];
	for (const [key, value] of Object.entries(context)) {
		if (value === undefined) continue;
		parts.push(`${key}=${formatValue(value)}`);
	}
	return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function formatValue(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
	return inspect(value, { depth: 4, breakLength: Infinity, compact: true, maxArrayLength: 20, maxStringLength: 300 });
}

function shouldColorStderr(): boolean {
	if (process.env.NO_COLOR !== undefined) return false;
	const force = process.env.FORCE_COLOR;
	if (force === "0") return false;
	if (force !== undefined) return true;
	return Boolean(process.stderr.isTTY);
}

function colorizeLine(level: LogLevel, line: string): string {
	const label = LEVEL_LABEL[level];
	const token = ` ${label} `;
	const index = line.indexOf(token);
	if (index < 0) return line;
	const timestamp = line.slice(0, index);
	const rest = line.slice(index + token.length);
	return `${ANSI.dim}${timestamp}${ANSI.reset} ${LEVEL_COLOR[level]}${label}${ANSI.reset} ${rest}`;
}

export function hostLogPath(dataDirectory: string): string {
	return join(dataDirectory, "logs", "runtime-host", "host.log");
}
