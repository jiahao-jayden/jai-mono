import { type Static, Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";
import type { AgentTool } from "../../core";
import { withFileMutationQueue } from "./file-mutation-queue";
import type { WorkspaceToolOptions } from "./types";

const replacementParameters = Type.Object(
	{ oldText: Type.String(), newText: Type.String() },
	{ additionalProperties: false },
);
const editParameters = Type.Object(
	{ path: Type.String(), edits: Type.Array(replacementParameters, { minItems: 1 }) },
	{ additionalProperties: false },
);
type EditErrorInit = { readonly message: string };
class EmptyOldText extends TaggedError("tool.edit.empty_old_text")<EditErrorInit> {}
class NoChange extends TaggedError("tool.edit.no_change")<EditErrorInit> {}
class TextNotFound extends TaggedError("tool.edit.text_not_found")<EditErrorInit> {}
class AmbiguousMatch extends TaggedError("tool.edit.ambiguous_match")<EditErrorInit> {}
class OverlappingEdits extends TaggedError("tool.edit.overlapping_edits")<EditErrorInit> {}
class EditAborted extends TaggedError("tool.edit.aborted")<EditErrorInit> {}
class InvalidUtf8 extends TaggedError("tool.edit.invalid_utf8")<EditErrorInit> {}
class FileChanged extends TaggedError("tool.edit.file_changed")<EditErrorInit> {}

function editError(
	reason:
		| "empty_old_text"
		| "no_change"
		| "text_not_found"
		| "ambiguous_match"
		| "overlapping_edits"
		| "aborted"
		| "invalid_utf8"
		| "file_changed",
	init: EditErrorInit,
) {
	switch (reason) {
		case "empty_old_text":
			return new EmptyOldText(init);
		case "no_change":
			return new NoChange(init);
		case "text_not_found":
			return new TextNotFound(init);
		case "ambiguous_match":
			return new AmbiguousMatch(init);
		case "overlapping_edits":
			return new OverlappingEdits(init);
		case "aborted":
			return new EditAborted(init);
		case "invalid_utf8":
			return new InvalidUtf8(init);
		case "file_changed":
			return new FileChanged(init);
	}
}

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
		} else text += raw[index];
		rawOffsets.push(index + 1);
	}
	return { text, rawOffsets };
}

function locateEdits(content: string, edits: EditToolInput["edits"]): LocatedEdit[] {
	const located = edits.map((edit) => {
		const oldText = edit.oldText.replaceAll("\r\n", "\n");
		const newText = edit.newText.replaceAll("\r\n", "\n");
		if (oldText.length === 0) throw editError("empty_old_text", { message: "oldText cannot be empty" });
		if (oldText === newText) {
			throw editError("no_change", { message: "No changes to apply: oldText and newText are identical" });
		}
		const start = content.indexOf(oldText);
		if (start === -1) {
			throw editError("text_not_found", {
				message:
					"Could not find oldText in the file. Re-read the file and retry with text copied exactly from its current contents.",
			});
		}
		if (content.indexOf(oldText, start + oldText.length) !== -1) {
			throw editError("ambiguous_match", {
				message: "Found multiple matches for oldText; provide more surrounding context",
			});
		}
		return { start, end: start + oldText.length, newText };
	});
	located.sort((a, b) => a.start - b.start);
	for (let index = 1; index < located.length; index++) {
		if (located[index]!.start < located[index - 1]!.end) {
			throw editError("overlapping_edits", { message: "Edits cannot overlap" });
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index++) if (left[index] !== right[index]) return false;
	return true;
}

export function createEditTool(options: WorkspaceToolOptions): AgentTool<typeof editParameters, EditToolDetails> {
	return {
		name: "Edit",
		description:
			"Edit one UTF-8 text file using exact, unique, non-overlapping replacements. Re-read the file if matching fails.",
		parameters: editParameters,
		executionMode: "sequential",
		async execute(_toolCallId, args, signal) {
			const resolved = await options.fileSystem.resolvePath(args.path, {
				base: options.workspaceRoot,
				boundary: options.workspaceRoot,
				mustExist: true,
				expectedKind: "file",
				signal,
			});
			return withFileMutationQueue(options.fileSystem, resolved.canonicalPath, async () => {
				if (signal?.aborted) throw editError("aborted", { message: "Operation aborted" });
				const originalBytes = await options.fileSystem.readFile(resolved.path, { signal });
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
					throw editError("invalid_utf8", { message: `File is not valid UTF-8 text: ${args.path}` });
				}
				const normalized = normalizeWithOffsets(rawContent);
				const located = locateEdits(normalized.text, args.edits);
				const firstChangedLine = normalized.text.slice(0, located[0]!.start).split("\n").length;
				const updated = applyLocatedEdits(rawContent, normalized, located);
				const currentBytes = await options.fileSystem.readFile(resolved.path, { signal });
				if (!equalBytes(currentBytes, originalBytes)) {
					throw editError("file_changed", { message: `File changed while editing: ${args.path}` });
				}
				if (signal?.aborted) throw editError("aborted", { message: "Operation aborted" });
				await options.fileSystem.writeFileAtomic(resolved.path, `${hasBom ? "\uFEFF" : ""}${updated}`, { signal });
				return {
					content: [
						{
							type: "text",
							text: `Successfully replaced ${located.length} block(s) in ${args.path}`,
						},
					],
					fileChanges: [{ operation: "modify", path: resolved.canonicalPath }],
					details: {
						path: resolved.path,
						replacements: located.length,
						firstChangedLine,
					},
				};
			});
		},
	};
}
