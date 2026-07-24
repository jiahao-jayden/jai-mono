import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AgentTool } from "@jai/agent";
import { type Static, Type } from "@sinclair/typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateText } from "../internal/truncate";
import { resolveWorkspacePath } from "../internal/workspace";
import type { BashToolOptions, TruncationDetails } from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const UPDATE_INTERVAL_MS = 100;
const TAIL_BUFFER_BYTES = DEFAULT_MAX_BYTES * 4;

const bashParameters = Type.Object(
	{
		command: Type.String({ minLength: 1 }),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS })),
	},
	{ additionalProperties: false },
);

export type BashToolInput = Static<typeof bashParameters>;

export interface BashToolDetails {
	exitCode: number | null;
	durationMs: number;
	timedOut: boolean;
	fullOutputPath?: string;
	truncation?: TruncationDetails;
}

function trimTailByBytes(value: string, maxBytes: number): string {
	const buffer = Buffer.from(value, "utf8");
	if (buffer.length <= maxBytes) return value;
	return buffer
		.subarray(buffer.length - maxBytes)
		.toString("utf8")
		.replace(/^\uFFFD/, "");
}

function killProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals = "SIGTERM"): void {
	if (!child.pid) return;
	if (process.platform !== "win32") {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {}
	}
	child.kill(signal);
}

function appendStatus(output: string, status: string): string {
	return output ? `${output}\n\n${status}` : status;
}

export function createBashTool(options: BashToolOptions): AgentTool<typeof bashParameters, BashToolDetails> {
	return {
		name: "bash",
		label: "bash",
		description: "Execute a POSIX shell command in the workspace with timeout, cancellation, and bounded output.",
		parameters: bashParameters,
		executionMode: "sequential",
		async execute(_toolCallId, args, signal, onUpdate) {
			const cwd = await resolveWorkspacePath(options.cwd, ".", {
				mustExist: true,
				expectedType: "directory",
				allowOutsideWorkspace: options.allowOutsideWorkspace,
			});
			if (signal?.aborted) throw new Error("Operation aborted");

			const timeoutMs = args.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			if (timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
				throw new Error(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`);
			}
			const shell = options.shell ?? process.env.SHELL ?? "/bin/sh";
			const outputDirectory = join(tmpdir(), "jai-tool-output");
			await mkdir(outputDirectory, { recursive: true });
			if (signal?.aborted) throw new Error("Operation aborted");
			const outputPath = join(outputDirectory, `bash-${randomUUID()}.log`);
			const fullOutput = createWriteStream(outputPath, { flags: "wx" });
			let child: ReturnType<typeof spawn> | undefined;
			let forceKillTimer: NodeJS.Timeout | undefined;
			let stop = () => {};
			let outputError: Error | undefined;
			const outputCompletion = new Promise<void>((resolve) => {
				fullOutput.once("finish", resolve);
				fullOutput.once("error", (error) => {
					outputError = error;
					child?.stdout?.destroy();
					child?.stderr?.destroy();
					stop();
					resolve();
				});
			});
			const decoder = new StringDecoder("utf8");
			const startedAt = Date.now();
			let tail = "";
			let totalBytes = 0;
			let newlineCount = 0;
			let sawOutput = false;
			let lastCharacterWasNewline = false;
			let timedOut = false;
			let aborted = false;
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let outputClosed = false;
			let keepOutput = false;
			let outputPaused = false;

			const snapshot = (): { text: string; truncation?: TruncationDetails; truncated: boolean } => {
				const totalLines = sawOutput ? newlineCount + (lastCharacterWasNewline ? 0 : 1) : 0;
				const result = truncateText(tail, {
					direction: "tail",
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});
				const truncated =
					totalBytes > DEFAULT_MAX_BYTES || totalLines > DEFAULT_MAX_LINES || result.details !== undefined;
				const truncation = truncated
					? {
							...(result.details ?? {
								truncated: true as const,
								direction: "tail" as const,
								outputLines: result.content ? result.content.split("\n").length : 0,
								outputBytes: Buffer.byteLength(result.content, "utf8"),
								maxLines: DEFAULT_MAX_LINES,
								maxBytes: DEFAULT_MAX_BYTES,
							}),
							totalLines,
						}
					: undefined;
				return {
					text: result.content,
					truncation,
					truncated,
				};
			};

			const emitUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				const current = snapshot();
				onUpdate({
					content: current.text ? [{ type: "text", text: current.text }] : [],
					details: {
						exitCode: null,
						durationMs: Date.now() - startedAt,
						timedOut: false,
						truncation: current.truncation,
					},
				});
			};

			const scheduleUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				if (updateTimer) return;
				updateTimer = setTimeout(() => {
					updateTimer = undefined;
					emitUpdate();
				}, UPDATE_INTERVAL_MS);
			};

			const append = (chunk: Buffer) => {
				const canContinue = fullOutput.write(chunk);
				if (!canContinue && !outputPaused) {
					outputPaused = true;
					child?.stdout?.pause();
					child?.stderr?.pause();
				}
				totalBytes += chunk.length;
				const text = decoder.write(chunk);
				if (!text) return;
				sawOutput = true;
				newlineCount += text.split("\n").length - 1;
				lastCharacterWasNewline = text.endsWith("\n");
				tail = trimTailByBytes(tail + text, TAIL_BUFFER_BYTES);
				scheduleUpdate();
			};

			fullOutput.on("drain", () => {
				outputPaused = false;
				child?.stdout?.resume();
				child?.stderr?.resume();
			});

			child = spawn(shell, ["-lc", args.command], {
				cwd,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
			child.stdout?.on("data", append);
			child.stderr?.on("data", append);
			const runningChild = child;

			stop = () => {
				killProcessTree(runningChild);
				forceKillTimer ??= setTimeout(() => killProcessTree(runningChild, "SIGKILL"), 1_000);
			};
			const abort = () => {
				aborted = true;
				stop();
			};
			signal?.addEventListener("abort", abort, { once: true });
			const timeout = setTimeout(() => {
				timedOut = true;
				stop();
			}, timeoutMs);

			try {
				const exitCode = await new Promise<number | null>((resolve, reject) => {
					child.once("error", reject);
					child.once("close", resolve);
				});
				const finalDecoded = decoder.end();
				if (finalDecoded) {
					sawOutput = true;
					newlineCount += finalDecoded.split("\n").length - 1;
					lastCharacterWasNewline = finalDecoded.endsWith("\n");
					tail = trimTailByBytes(tail + finalDecoded, TAIL_BUFFER_BYTES);
				}
				fullOutput.end();
				await outputCompletion;
				if (outputError) throw outputError;
				outputClosed = true;

				const final = snapshot();
				const text = final.text || "(no output)";
				keepOutput = final.truncated;
				const details: BashToolDetails = {
					exitCode,
					durationMs: Date.now() - startedAt,
					timedOut,
					fullOutputPath: final.truncated ? outputPath : undefined,
					truncation: final.truncation,
				};

				const diagnosticText = final.truncated
					? appendStatus(final.text, `[Output truncated. Full output: ${outputPath}]`)
					: final.text;
				if (aborted || signal?.aborted) {
					throw new Error(appendStatus(diagnosticText, "Command aborted"));
				}
				if (timedOut) {
					throw new Error(appendStatus(diagnosticText, `Command timed out after ${timeoutMs}ms`));
				}
				if (exitCode !== 0) {
					throw new Error(appendStatus(diagnosticText, `Command exited with code ${exitCode}`));
				}

				let resultText = text;
				if (final.truncated) {
					resultText += `\n\n[Output truncated. Full output: ${outputPath}]`;
				}
				return {
					content: [{ type: "text", text: resultText }],
					details,
				};
			} finally {
				clearTimeout(timeout);
				if (updateTimer) clearTimeout(updateTimer);
				if (forceKillTimer) clearTimeout(forceKillTimer);
				signal?.removeEventListener("abort", abort);
				if (!outputClosed) {
					fullOutput.end();
					await outputCompletion;
				}
				if (!keepOutput) await rm(outputPath, { force: true });
			}
		},
	};
}
