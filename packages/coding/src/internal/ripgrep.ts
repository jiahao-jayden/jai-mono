import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const MAX_STDERR_BYTES = 50 * 1024;
const MAX_MATCH_COLUMNS = 2_000;

interface StderrBuffer {
	chunks: Buffer[];
	bytes: number;
	truncated: boolean;
}

function executable(): string {
	const path = Bun.which("rg");
	if (!path) throw new Error("ripgrep (rg) is required for glob and grep");
	return path;
}

function createCompletion(child: ReturnType<typeof spawn>, stderr: StderrBuffer): Promise<{ code: number | null }> {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code) => resolve({ code }));
		child.stderr?.on("data", (chunk: Buffer) => {
			const remaining = MAX_STDERR_BYTES - stderr.bytes;
			if (remaining <= 0) {
				stderr.truncated = true;
				return;
			}
			const kept = chunk.subarray(0, remaining);
			stderr.chunks.push(kept);
			stderr.bytes += kept.length;
			stderr.truncated ||= kept.length < chunk.length;
		});
	});
}

function stderrMessage(stderr: StderrBuffer, fallback: string): string {
	const message = Buffer.concat(stderr.chunks).toString("utf8").trim();
	if (!message) return fallback;
	return stderr.truncated ? `${message}\n[stderr truncated]` : message;
}

export async function collectFilePaths(options: {
	cwd: string;
	pattern: string;
	limit: number;
	signal?: AbortSignal;
}): Promise<{ paths: string[]; resultLimitReached: boolean }> {
	if (options.signal?.aborted) throw new Error("Operation aborted");
	const child = spawn(executable(), ["--files", "--hidden", "--glob", options.pattern, "--", "."], {
		cwd: options.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stderr: StderrBuffer = { chunks: [], bytes: 0, truncated: false };
	const completion = createCompletion(child, stderr);
	const lines = createInterface({ input: child.stdout! });
	const paths: string[] = [];
	let resultLimitReached = false;
	const abort = () => child.kill();
	options.signal?.addEventListener("abort", abort, { once: true });

	try {
		for await (const line of lines) {
			if (paths.length >= options.limit) {
				resultLimitReached = true;
				child.kill();
				break;
			}
			if (line) paths.push(line.replaceAll("\\", "/").replace(/^\.\//, ""));
		}
		const { code } = await completion;
		if (options.signal?.aborted) throw new Error("Operation aborted");
		if (!resultLimitReached && code !== 0 && code !== 1) {
			throw new Error(stderrMessage(stderr, `ripgrep exited with code ${code}`));
		}
	} finally {
		options.signal?.removeEventListener("abort", abort);
		lines.close();
	}

	return { paths, resultLimitReached };
}

interface RipgrepJsonEvent {
	type?: string;
	data?: {
		path?: { text?: string };
		lines?: { text?: string };
		line_number?: number;
	};
}

export async function collectMatches(options: {
	cwd: string;
	target: string;
	pattern: string;
	include?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	context?: number;
	limit: number;
	signal?: AbortSignal;
}): Promise<{
	lines: string[];
	matches: number;
	matchLimitReached: boolean;
}> {
	if (options.signal?.aborted) throw new Error("Operation aborted");
	const args = [
		"--json",
		"--line-number",
		"--color=never",
		"--hidden",
		"--max-columns",
		String(MAX_MATCH_COLUMNS),
		"--max-columns-preview",
	];
	if (options.ignoreCase) args.push("--ignore-case");
	if (options.literal) args.push("--fixed-strings");
	if (options.include) args.push("--glob", options.include);
	if (options.context && options.context > 0) args.push("--context", String(options.context));
	args.push("--", options.pattern, options.target);

	const child = spawn(executable(), args, {
		cwd: options.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stderr: StderrBuffer = { chunks: [], bytes: 0, truncated: false };
	const completion = createCompletion(child, stderr);
	const output = createInterface({ input: child.stdout! });
	const lines: string[] = [];
	let matches = 0;
	let matchLimitReached = false;
	let trailingContextRemaining: number | undefined;
	const abort = () => child.kill();
	options.signal?.addEventListener("abort", abort, { once: true });

	try {
		for await (const line of output) {
			let event: RipgrepJsonEvent;
			try {
				event = JSON.parse(line) as RipgrepJsonEvent;
			} catch {
				continue;
			}
			if (event.type !== "match" && event.type !== "context") continue;
			if (event.type === "match" && matchLimitReached) {
				child.kill();
				break;
			}

			const path = event.data?.path?.text?.replaceAll("\\", "/").replace(/^\.\//, "");
			const lineNumber = event.data?.line_number;
			const text = event.data?.lines?.text?.replace(/\r?\n$/, "");
			if (!path || lineNumber === undefined || text === undefined) continue;
			const separator = event.type === "match" ? ":" : "-";
			lines.push(`${path}${separator}${lineNumber}${separator} ${text}`);

			if (event.type === "match") {
				matches++;
				if (matches >= options.limit) {
					matchLimitReached = true;
					trailingContextRemaining = options.context ?? 0;
					if (trailingContextRemaining === 0) {
						child.kill();
						break;
					}
				}
			} else if (trailingContextRemaining !== undefined) {
				trailingContextRemaining--;
				if (trailingContextRemaining === 0) {
					child.kill();
					break;
				}
			}
		}

		const { code } = await completion;
		if (options.signal?.aborted) throw new Error("Operation aborted");
		if (!matchLimitReached && code !== 0 && code !== 1) {
			throw new Error(stderrMessage(stderr, `ripgrep exited with code ${code}`));
		}
	} finally {
		options.signal?.removeEventListener("abort", abort);
		output.close();
	}

	return { lines, matches, matchLimitReached };
}
