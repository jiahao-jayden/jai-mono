import { getErrorMessage } from "@jai/common";
import { type Static, Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";
import type { AgentTool } from "../../core";
import type { ShellResult } from "../environment";
import { byteLength, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateText } from "./truncate";
import type { BashToolOptions, TruncationDetails } from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const UPDATE_INTERVAL_MS = 100;
const TAIL_BUFFER_BYTES = DEFAULT_MAX_BYTES * 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bashParameters = Type.Object(
	{
		command: Type.String({ minLength: 1 }),
		timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS })),
	},
	{ additionalProperties: false },
);
class BashAborted extends TaggedError("tool.bash.aborted")<BashErrorInit> {}
class BashInvalidTimeout extends TaggedError("tool.bash.invalid_timeout")<BashErrorInit> {}
class BashTimeout extends TaggedError("tool.bash.timeout")<BashErrorInit> {}
class BashExecutionFailed extends TaggedError("tool.bash.execution_failed")<BashErrorInit> {}
class BashNonZeroExit extends TaggedError("tool.bash.non_zero_exit")<BashErrorInit> {}
type BashErrorInit = { readonly cause?: unknown; readonly message: string };

function bashError(
	reason: "aborted" | "invalid_timeout" | "timeout" | "execution_failed" | "non_zero_exit",
	init: BashErrorInit,
) {
	switch (reason) {
		case "aborted":
			return new BashAborted(init);
		case "invalid_timeout":
			return new BashInvalidTimeout(init);
		case "timeout":
			return new BashTimeout(init);
		case "execution_failed":
			return new BashExecutionFailed(init);
		case "non_zero_exit":
			return new BashNonZeroExit(init);
	}
}

export type BashToolInput = Static<typeof bashParameters>;
export interface BashToolDetails {
	exitCode: number | null;
	durationMs: number;
	timedOut: boolean;
	fullOutputPath?: string;
	truncation?: TruncationDetails;
}

function trimTailByBytes(value: string, maxBytes: number): string {
	const bytes = encoder.encode(value);
	if (bytes.byteLength <= maxBytes) return value;
	return decoder.decode(bytes.subarray(bytes.byteLength - maxBytes)).replace(/^\uFFFD/, "");
}

function appendStatus(output: string, status: string): string {
	return output ? `${output}\n\n${status}` : status;
}

export function createBashTool(options: BashToolOptions): AgentTool<typeof bashParameters, BashToolDetails> {
	return {
		name: "Bash",
		activityKind: "execute",
		title: (args) => `Run ${args.command}`,
		description: "Execute a POSIX shell command in the workspace with timeout, cancellation, and bounded output.",
		parameters: bashParameters,
		executionMode: "sequential",
		async execute(_toolCallId, args, signal, onUpdate) {
			const cwd = await options.fileSystem.resolvePath(".", {
				base: options.workspaceRoot,
				boundary: options.workspaceRoot,
				mustExist: true,
				expectedKind: "directory",
				signal,
			});
			if (signal?.aborted) throw bashError("aborted", { message: "Operation aborted" });
			const timeoutMs = args.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
			if (timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
				throw bashError("invalid_timeout", { message: `timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}` });
			}
			const temporaryFile = await options.fileSystem.createTempFile({
				prefix: "bash-",
				suffix: ".log",
				signal,
			});
			const startedAt = Date.now();
			let tail = "";
			let totalBytes = 0;
			let newlineCount = 0;
			let sawOutput = false;
			let lastCharacterWasNewline = false;
			let updateTimer: ReturnType<typeof setTimeout> | undefined;
			let updateDirty = false;
			let keepOutput = false;
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
								outputBytes: byteLength(result.content),
								maxLines: DEFAULT_MAX_LINES,
								maxBytes: DEFAULT_MAX_BYTES,
							}),
							totalLines,
						}
					: undefined;
				return { text: result.content, truncation, truncated };
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
			const append = async (text: string) => {
				await temporaryFile.append(text);
				totalBytes += byteLength(text);
				if (!text) return;
				sawOutput = true;
				newlineCount += text.split("\n").length - 1;
				lastCharacterWasNewline = text.endsWith("\n");
				tail = trimTailByBytes(tail + text, TAIL_BUFFER_BYTES);
				scheduleUpdate();
			};
			try {
				let shellResult: ShellResult;
				try {
					shellResult = await options.shell.execute(args.command, {
						cwd: cwd.path,
						timeoutMs,
						signal,
						onOutput: (chunk) => append(chunk.text),
					});
				} catch (error) {
					const final = snapshot();
					keepOutput = final.truncated;
					const diagnostic = final.truncated
						? appendStatus(final.text, `[Output truncated. Full output: ${temporaryFile.path}]`)
						: final.text;
					if (TaggedError.is(error) && error._tag === "shell.aborted") {
						throw bashError("aborted", { message: appendStatus(diagnostic, "Command aborted"), cause: error });
					}
					if (TaggedError.is(error) && error._tag === "shell.timeout") {
						throw bashError("timeout", {
							message: appendStatus(diagnostic, `Command timed out after ${timeoutMs}ms`),
							cause: error,
						});
					}
					throw bashError("execution_failed", {
						message: appendStatus(diagnostic, getErrorMessage(error)),
						cause: error,
					});
				}
				const final = snapshot();
				const text = final.text || "(no output)";
				keepOutput = final.truncated;
				const details: BashToolDetails = {
					exitCode: shellResult.exitCode,
					durationMs: shellResult.durationMs,
					timedOut: false,
					fullOutputPath: final.truncated ? temporaryFile.path : undefined,
					truncation: final.truncation,
				};
				const diagnosticText = final.truncated
					? appendStatus(final.text, `[Output truncated. Full output: ${temporaryFile.path}]`)
					: final.text;
				if (shellResult.exitCode !== 0) {
					throw bashError("non_zero_exit", {
						message: appendStatus(diagnosticText, `Command exited with code ${shellResult.exitCode}`),
					});
				}
				return {
					content: [
						{
							type: "text",
							text: final.truncated ? `${text}\n\n[Output truncated. Full output: ${temporaryFile.path}]` : text,
						},
					],
					details,
				};
			} finally {
				if (updateTimer) clearTimeout(updateTimer);
				if (!keepOutput) await temporaryFile.remove();
			}
		},
	};
}
