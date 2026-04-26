import { defineAgentTool } from "@jayden/jai-agent";
import z from "zod";

const CONTEXT_LINES = 50;

function findAllOccurrences(content: string, search: string): number[] {
	const positions: number[] = [];
	let idx = 0;
	while (true) {
		idx = content.indexOf(search, idx);
		if (idx === -1) break;
		positions.push(idx);
		idx += search.length;
	}
	return positions;
}

function charOffsetToLine(content: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < content.length; i++) {
		if (content[i] === "\n") line++;
	}
	return line;
}

export const fileEditTool = defineAgentTool({
	name: "FileEdit",
	label: "Edit file",
	description: `Make precise string replacements in an existing file. Preferred over FileWrite for any partial modification.

HOW TO SUCCEED:
- old_string must be an EXACT verbatim copy from the file (whitespace, indentation, line breaks all matter). Copy it directly from FileRead output.
- Include 3–5 lines of surrounding context in old_string so it uniquely identifies the target location. Single-line matches often collide.
- When making multiple edits to the same file, work from BOTTOM to TOP so earlier edits don't shift line numbers of later targets.
- If old_string is not found, the error includes the file's current content — use it to correct your match.
- If old_string matches multiple locations, either add more context to make it unique, or set replace_all=true.

RULES:
- You MUST FileRead the file first — never guess file content.
- old_string and new_string must differ.
- To delete code, set new_string to an empty string.`,
	parameters: z.object({
		path: z.string().describe("File path to edit"),
		old_string: z.string().describe("Exact string to find and replace"),
		new_string: z.string().describe("Replacement string"),
		replace_all: z.boolean().default(false).describe("Replace all occurrences (default: first only)"),
	}),
	validate(params) {
		if (!params.path.trim()) {
			return "Path must not be empty.";
		}
		if (!params.old_string) {
			return "old_string must not be empty. To append content, use FileWrite instead.";
		}
		if (params.old_string === params.new_string) {
			return "old_string and new_string are identical — nothing to change.";
		}
	},
	async execute(params) {
		const { path, old_string, new_string, replace_all } = params;

		try {
			const file = Bun.file(path);
			if (!(await file.exists())) {
				return { content: [{ type: "text" as const, text: `Error: File not found: ${path}` }], isError: true };
			}

			const content = await file.text();
			const positions = findAllOccurrences(content, old_string);

			if (positions.length === 0) {
				const lines = content.split("\n");
				const preview = lines.slice(0, CONTEXT_LINES).join("\n");
				const suffix = lines.length > CONTEXT_LINES ? `\n... (${lines.length - CONTEXT_LINES} more lines)` : "";

				return {
					content: [
						{
							type: "text" as const,
							text: [
								`Error: old_string not found in ${path}`,
								"",
								"The file currently contains:",
								"---",
								`// File: ${path} (first ${Math.min(lines.length, CONTEXT_LINES)} lines shown)`,
								preview + suffix,
								"---",
								"",
								"Make sure old_string exactly matches the content in the file, including whitespace and indentation.",
							].join("\n"),
						},
					],
					isError: true,
				};
			}

			if (positions.length > 1 && !replace_all) {
				const lineNumbers = positions.map((p) => charOffsetToLine(content, p));
				return {
					content: [
						{
							type: "text" as const,
							text: [
								`Error: old_string matches ${positions.length} locations in ${path}.`,
								`Provide more context in old_string to uniquely identify the target location, or set replace_all=true to replace all occurrences.`,
								"",
								`Matches found at lines: ${lineNumbers.join(", ")}`,
							].join("\n"),
						},
					],
					isError: true,
				};
			}

			let newContent: string;
			let count: number;

			if (replace_all) {
				newContent = content.replaceAll(old_string, new_string);
				count = positions.length;
			} else {
				const pos = positions[0];
				newContent = content.slice(0, pos) + new_string + content.slice(pos + old_string.length);
				count = 1;
			}

			await Bun.write(path, newContent);

			const lineNumbers = positions.slice(0, count).map((p) => charOffsetToLine(content, p));
			const lineInfo = count === 1 ? `(line ${lineNumbers[0]})` : `(lines ${lineNumbers.join(", ")})`;

			return {
				content: [
					{
						type: "text" as const,
						text: `Replaced ${count} occurrence${count > 1 ? "s" : ""} in ${path} ${lineInfo}`,
					},
				],
			};
		} catch (err) {
			return {
				content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
				isError: true,
			};
		}
	},
});
