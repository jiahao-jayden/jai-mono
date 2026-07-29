import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool } from "../../core";
import { ShellError, type ShellResult } from "../environment";
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
		name: "bash",
		label: "bash",
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
			if (signal?.aborted) throw new Error("Operation aborted");
			const timeoutMs = args.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
			if (timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
				throw new Error(`timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}`);
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
					if (error instanceof ShellError && error.code === "aborted") {
						throw new Error(appendStatus(diagnostic, "Command aborted"));
					}
					if (error instanceof ShellError && error.code === "timeout") {
						throw new Error(appendStatus(diagnostic, `Command timed out after ${timeoutMs}ms`));
					}
					throw new Error(appendStatus(diagnostic, error instanceof Error ? error.message : "Command failed"));
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
					throw new Error(appendStatus(diagnosticText, `Command exited with code ${shellResult.exitCode}`));
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
