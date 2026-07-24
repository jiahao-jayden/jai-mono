import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { AgentTool } from "@jai/agent";
import { type Static, Type } from "@sinclair/typebox";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_LENGTH, DEFAULT_MAX_LINES } from "../internal/truncate";
import { resolveWorkspacePath } from "../internal/workspace";
import type { CodingToolOptions, TruncationDetails } from "./types";

const readParameters = Type.Object(
	{
		path: Type.String(),
		offset: Type.Optional(Type.Integer({ minimum: 1 })),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: DEFAULT_MAX_LINES })),
	},
	{ additionalProperties: false },
);

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

async function assertTextFile(path: string): Promise<void> {
	const file = await open(path, "r");
	try {
		const sample = Buffer.alloc(4_096);
		const { bytesRead } = await file.read(sample, 0, sample.length, 0);
		const bytes = sample.subarray(0, bytesRead);
		if (bytes.includes(0)) throw new Error(`Cannot read binary file: ${path}`);

		let controlCharacters = 0;
		for (const byte of bytes) {
			if (byte < 9 || (byte > 13 && byte < 32)) controlCharacters++;
		}
		if (bytes.length > 0 && controlCharacters / bytes.length > 0.3) {
			throw new Error(`Cannot read binary file: ${path}`);
		}
	} finally {
		await file.close();
	}
}

export function createReadTool(options: CodingToolOptions): AgentTool<typeof readParameters, ReadToolDetails> {
	return {
		name: "read",
		label: "read",
		description: "Read a UTF-8 text file with line numbers. Use offset and limit to continue through large files.",
		parameters: readParameters,
		executionMode: "parallel",
		async execute(_toolCallId, args, signal) {
			const absolutePath = await resolveWorkspacePath(options.cwd, args.path, {
				mustExist: true,
				expectedType: "file",
				allowOutsideWorkspace: options.allowOutsideWorkspace,
			});
			if (signal?.aborted) throw new Error("Operation aborted");
			await assertTextFile(absolutePath);

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
			const decoder = new TextDecoder("utf-8", { fatal: true });

			const appendLineSegment = (segment: string): void => {
				const remaining = DEFAULT_MAX_LINE_LENGTH - lineBuffer.length;
				if (segment.length > remaining) {
					if (remaining > 0) lineBuffer += segment.slice(0, remaining);
					currentLineTruncated = true;
					return;
				}
				lineBuffer += segment;
			};

			const consumeLine = (): void => {
				totalLines++;
				if (totalLines < offset || selected.length >= limit || bytesCapped) {
					lineBuffer = "";
					currentLineTruncated = false;
					return;
				}

				let display = lineBuffer.endsWith("\r") ? lineBuffer.slice(0, -1) : lineBuffer;
				if (currentLineTruncated) {
					display += "… [line truncated]";
					linesTruncated = true;
				}
				const formatted = `${totalLines}|${display}`;
				const bytes = Buffer.byteLength(formatted, "utf8") + (selected.length > 0 ? 1 : 0);
				if (outputBytes + bytes > DEFAULT_MAX_BYTES) {
					bytesCapped = true;
				} else {
					selected.push(formatted);
					outputBytes += bytes;
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
				const stream = createReadStream(absolutePath, { signal });
				for await (const chunk of stream) {
					if (signal?.aborted) throw new Error("Operation aborted");
					sawData = true;
					consumeDecodedText(decoder.decode(chunk as Buffer, { stream: true }));
				}
				consumeDecodedText(decoder.decode());
			} catch (error) {
				if (signal?.aborted) throw new Error("Operation aborted");
				if (error instanceof TypeError) throw new Error(`File is not valid UTF-8 text: ${args.path}`);
				throw error;
			}

			if (sawData || lineBuffer.length > 0) consumeLine();
			if (offset > Math.max(1, totalLines)) {
				throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines)`);
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
					path: absolutePath,
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
