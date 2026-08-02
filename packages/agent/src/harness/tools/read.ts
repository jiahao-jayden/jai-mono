import { type Static, Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";
import type { AgentTool } from "../../core";
import { byteLength, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_LENGTH, DEFAULT_MAX_LINES } from "./truncate";
import type { TruncationDetails, WorkspaceToolOptions } from "./types";

const readParameters = Type.Object(
	{
		path: Type.String(),
		offset: Type.Optional(Type.Integer({ minimum: 1 })),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: DEFAULT_MAX_LINES })),
	},
	{ additionalProperties: false },
);
type ReadErrorInit = { readonly cause?: unknown; readonly message: string };
class ReadAborted extends TaggedError("tool.read.aborted")<ReadErrorInit> {}
class BinaryFile extends TaggedError("tool.read.binary_file")<ReadErrorInit> {}
class InvalidUtf8 extends TaggedError("tool.read.invalid_utf8")<ReadErrorInit> {}
class OffsetOutOfRange extends TaggedError("tool.read.offset_out_of_range")<ReadErrorInit> {}

function readError(reason: "aborted" | "binary_file" | "invalid_utf8" | "offset_out_of_range", init: ReadErrorInit) {
	switch (reason) {
		case "aborted":
			return new ReadAborted(init);
		case "binary_file":
			return new BinaryFile(init);
		case "invalid_utf8":
			return new InvalidUtf8(init);
		case "offset_out_of_range":
			return new OffsetOutOfRange(init);
	}
}

export type ReadToolInput = Static<typeof readParameters>;
export interface ReadToolDetails {
	path: string;
	startLine: number;
	endLine: number;
	totalLines: number;
	truncated: boolean;
	nextOffset?: number;
	truncation?: TruncationDetails;
}

export function createReadTool(options: WorkspaceToolOptions): AgentTool<typeof readParameters, ReadToolDetails> {
	return {
		name: "Read",
		label: "Read",
		description: "Read a UTF-8 text file with line numbers. Use offset and limit to continue through large files.",
		parameters: readParameters,
		executionMode: "parallel",
		async execute(_toolCallId, args, signal) {
			const resolved = await options.fileSystem.resolvePath(args.path, {
				base: options.workspaceRoot,
				boundary: options.workspaceRoot,
				mustExist: true,
				expectedKind: "file",
				signal,
			});
			if (signal?.aborted) throw readError("aborted", { message: "Operation aborted" });
			const offset = args.offset ?? 1;
			const limit = args.limit ?? DEFAULT_MAX_LINES;
			const selected: string[] = [];
			let outputBytes = 0;
			let totalLines = 0;
			let sawData = false;
			let bytesCapped = false;
			let linesTruncated = false;
			let lineBuffer = "";
			let currentLineTruncated = false;
			let sampled = 0;
			let controlCharacters = 0;
			const decoder = new TextDecoder("utf-8", { fatal: true });
			const appendLineSegment = (segment: string): void => {
				const remaining = DEFAULT_MAX_LINE_LENGTH - lineBuffer.length;
				if (segment.length > remaining) {
					if (remaining > 0) lineBuffer += segment.slice(0, remaining);
					currentLineTruncated = true;
				} else {
					lineBuffer += segment;
				}
			};
			const consumeLine = (): void => {
				totalLines++;
				if (totalLines >= offset && selected.length < limit && !bytesCapped) {
					let display = lineBuffer.endsWith("\r") ? lineBuffer.slice(0, -1) : lineBuffer;
					if (currentLineTruncated) {
						display += "… [line truncated]";
						linesTruncated = true;
					}
					const formatted = `${totalLines}|${display}`;
					const bytes = byteLength(formatted) + (selected.length > 0 ? 1 : 0);
					if (outputBytes + bytes > DEFAULT_MAX_BYTES) bytesCapped = true;
					else {
						selected.push(formatted);
						outputBytes += bytes;
					}
				}
				lineBuffer = "";
				currentLineTruncated = false;
			};
			const consumeDecodedText = (text: string): void => {
				const segments = text.split("\n");
				for (let index = 0; index < segments.length - 1; index++) {
					appendLineSegment(segments[index] ?? "");
					consumeLine();
				}
				appendLineSegment(segments.at(-1) ?? "");
			};
			try {
				for await (const chunk of options.fileSystem.readFileChunks(resolved.path, { signal })) {
					if (signal?.aborted) throw readError("aborted", { message: "Operation aborted" });
					sawData = true;
					if (sampled < 4_096) {
						const sample = chunk.subarray(0, 4_096 - sampled);
						for (const value of sample) {
							if (value === 0) {
								throw readError("binary_file", { message: `Cannot read binary file: ${resolved.path}` });
							}
							if (value < 9 || (value > 13 && value < 32)) controlCharacters++;
						}
						sampled += sample.byteLength;
					}
					consumeDecodedText(decoder.decode(chunk, { stream: true }));
				}
				if (sampled > 0 && controlCharacters / sampled > 0.3) {
					throw readError("binary_file", { message: `Cannot read binary file: ${resolved.path}` });
				}
				consumeDecodedText(decoder.decode());
			} catch (error) {
				if (signal?.aborted) throw readError("aborted", { message: "Operation aborted" });
				if (error instanceof TypeError) {
					throw readError("invalid_utf8", { message: `File is not valid UTF-8 text: ${args.path}`, cause: error });
				}
				throw error;
			}
			if (sawData || lineBuffer.length > 0) consumeLine();
			if (offset > Math.max(1, totalLines)) {
				throw readError("offset_out_of_range", {
					message: `Offset ${offset} is beyond end of file (${totalLines} lines)`,
				});
			}
			const hasMore = offset - 1 + selected.length < totalLines;
			const truncated = hasMore || bytesCapped || linesTruncated;
			const nextOffset = hasMore ? offset + selected.length : undefined;
			let text = selected.join("\n");
			if (!text && totalLines === 0) text = "(empty file)";
			if (truncated) {
				const endLine = offset + selected.length - 1;
				const continuation = nextOffset ? ` Use offset=${nextOffset} to continue.` : "";
				text += `\n\n[Showing lines ${offset}-${Math.max(offset, endLine)} of ${totalLines}.${continuation}]`;
			}
			const truncation: TruncationDetails | undefined = truncated
				? {
						truncated: true,
						direction: "head",
						totalLines,
						outputLines: selected.length,
						outputBytes,
						maxLines: limit,
						maxBytes: DEFAULT_MAX_BYTES,
					}
				: undefined;
			return {
				content: [{ type: "text", text }],
				details: {
					path: resolved.path,
					startLine: totalLines === 0 ? 0 : offset,
					endLine: totalLines === 0 ? 0 : offset + selected.length - 1,
					totalLines,
					truncated,
					nextOffset,
					truncation,
				},
			};
		},
	};
}
