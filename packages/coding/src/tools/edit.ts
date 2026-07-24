import { readFile } from "node:fs/promises";
import type { AgentTool } from "@jai/agent";
import { type Static, Type } from "@sinclair/typebox";
import { atomicWrite } from "../internal/atomic-write";
import { withFileMutationQueue } from "../internal/file-mutation-queue";
import { resolveWorkspacePath } from "../internal/workspace";
import type { CodingToolOptions } from "./types";

const replacementParameters = Type.Object(
	{
		oldText: Type.String(),
		newText: Type.String(),
	},
	{ additionalProperties: false },
);

const editParameters = Type.Object(
	{
		path: Type.String(),
		edits: Type.Array(replacementParameters, { minItems: 1 }),
	},
	{ additionalProperties: false },
);

export type EditToolInput = Static<typeof editParameters>;

export interface EditToolDetails {
	path: string;
	replacements: number;
	firstChangedLine?: number;
}

interface LocatedEdit {
	start: number;
	end: number;
	newText: string;
}

interface NormalizedContent {
	text: string;
	rawOffsets: number[];
}

function normalizeWithOffsets(raw: string): NormalizedContent {
	let text = "";
	const rawOffsets = [0];

	for (let index = 0; index < raw.length; index++) {
		if (raw[index] === "\r" && raw[index + 1] === "\n") {
			text += "\n";
			index++;
		} else {
			text += raw[index];
		}
		rawOffsets.push(index + 1);
	}
	return { text, rawOffsets };
}

function locateEdits(content: string, edits: EditToolInput["edits"]): LocatedEdit[] {
	const located = edits.map((edit) => {
		const oldText = edit.oldText.replaceAll("\r\n", "\n");
		const newText = edit.newText.replaceAll("\r\n", "\n");
		if (oldText.length === 0) throw new Error("oldText cannot be empty");
		if (oldText === newText) throw new Error("No changes to apply: oldText and newText are identical");

		const start = content.indexOf(oldText);
		if (start === -1) throw new Error("Could not find oldText in the file");
		if (content.indexOf(oldText, start + oldText.length) !== -1) {
			throw new Error("Found multiple matches for oldText; provide more surrounding context");
		}
		return {
			start,
			end: start + oldText.length,
			newText,
		};
	});

	located.sort((a, b) => a.start - b.start);
	for (let index = 1; index < located.length; index++) {
		if (located[index]!.start < located[index - 1]!.end) {
			throw new Error("Edits cannot overlap");
		}
	}
	return located;
}

function lineEndingNear(raw: string, start: number, end: number): "\n" | "\r\n" {
	const within = raw.indexOf("\n", start);
	const before = raw.lastIndexOf("\n", start - 1);
	const after = raw.indexOf("\n", end);
	let newlineIndex = within >= 0 && within < end ? within : before;
	if (newlineIndex < 0 || (after >= 0 && after - end < start - newlineIndex)) newlineIndex = after;
	return newlineIndex > 0 && raw[newlineIndex - 1] === "\r" ? "\r\n" : "\n";
}

function applyLocatedEdits(raw: string, normalized: NormalizedContent, edits: LocatedEdit[]): string {
	let result = raw;
	for (const edit of [...edits].reverse()) {
		const rawStart = normalized.rawOffsets[edit.start]!;
		const rawEnd = normalized.rawOffsets[edit.end]!;
		const lineEnding = lineEndingNear(raw, rawStart, rawEnd);
		const replacement = lineEnding === "\r\n" ? edit.newText.replaceAll("\n", "\r\n") : edit.newText;
		result = result.slice(0, rawStart) + replacement + result.slice(rawEnd);
	}
	return result;
}

async function readFileWithAbort(path: string, signal?: AbortSignal): Promise<Buffer> {
	try {
		return await readFile(path, { signal });
	} catch (error) {
		if (signal?.aborted) throw new Error("Operation aborted");
		throw error;
	}
}

export function createEditTool(options: CodingToolOptions): AgentTool<typeof editParameters, EditToolDetails> {
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit one UTF-8 text file using exact, unique, non-overlapping replacements. Re-read the file if matching fails.",
		parameters: editParameters,
		executionMode: "sequential",
		async execute(_toolCallId, args, signal) {
			const absolutePath = await resolveWorkspacePath(options.cwd, args.path, {
				mustExist: true,
				expectedType: "file",
				allowOutsideWorkspace: options.allowOutsideWorkspace,
			});

			return withFileMutationQueue(absolutePath, async () => {
				if (signal?.aborted) throw new Error("Operation aborted");
				const originalBytes = await readFileWithAbort(absolutePath, signal);
				if (signal?.aborted) throw new Error("Operation aborted");

				const hasBom =
					originalBytes.length >= 3 &&
					originalBytes[0] === 0xef &&
					originalBytes[1] === 0xbb &&
					originalBytes[2] === 0xbf;
				let rawContent: string;
				try {
					rawContent = new TextDecoder("utf-8", { fatal: true }).decode(
						hasBom ? originalBytes.subarray(3) : originalBytes,
					);
				} catch {
					throw new Error(`File is not valid UTF-8 text: ${args.path}`);
				}

				const normalized = normalizeWithOffsets(rawContent);
				const located = locateEdits(normalized.text, args.edits);
				const firstChangedLine = normalized.text.slice(0, located[0]!.start).split("\n").length;
				const updated = applyLocatedEdits(rawContent, normalized, located);
				const currentBytes = await readFileWithAbort(absolutePath, signal);
				if (!currentBytes.equals(originalBytes)) {
					throw new Error(`File changed while editing: ${args.path}`);
				}
				if (signal?.aborted) throw new Error("Operation aborted");

				await atomicWrite(absolutePath, `${hasBom ? "\uFEFF" : ""}${updated}`, signal);

				return {
					content: [
						{
							type: "text",
							text: `Successfully replaced ${located.length} block(s) in ${args.path}`,
						},
					],
					details: {
						path: absolutePath,
						replacements: located.length,
						firstChangedLine,
					},
				};
			});
		},
	};
}
