import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { defineAgentTool } from "@jayden/jai-agent";
import z from "zod";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export const fileWriteTool = defineAgentTool({
	name: "FileWrite",
	label: "Write file",
	description: `Write complete content to a file, creating it (and parent directories) if needed, or overwriting if it exists.

WHEN TO USE:
- Creating a brand-new file.
- Rewriting a file where the majority of content is changing.

WHEN NOT TO USE:
- Modifying part of an existing file → use FileEdit instead. Rewriting a large file just to change a few lines wastes tokens and risks losing content.

RULES:
- You MUST read the file first (FileRead) before deciding between FileWrite and FileEdit.
- Provide the COMPLETE final content — this tool replaces the entire file.
- Preserve the existing file's indentation style (tabs vs spaces) and line ending convention.
- Max content size: 10 MB.`,
	parameters: z.object({
		path: z.string().describe("File path to write to"),
		content: z.string().describe("Complete file content to write"),
	}),
	validate(params) {
		if (!params.path.trim()) {
			return "Path must not be empty.";
		}
		if (params.content.length > MAX_SIZE) {
			return `Content too large: ${(params.content.length / 1024 / 1024).toFixed(1)}MB exceeds 10MB limit.`;
		}
	},
	async execute(params) {
		const { path, content } = params;

		try {
			const dir = dirname(path);
			let createdDir = false;

			const dirFile = Bun.file(dir);
			if (!(await dirFile.exists())) {
				await mkdir(dir, { recursive: true });
				createdDir = true;
			}

			await Bun.write(path, content);
			const bytes = Buffer.byteLength(content, "utf8");
			const formatted = bytes.toLocaleString();

			const parts: string[] = [];
			if (createdDir) {
				parts.push(`Created directory ${dir}`);
			}
			parts.push(`Written ${formatted} bytes to ${path}`);

			return { content: [{ type: "text" as const, text: parts.join("\n") }] };
		} catch (err) {
			return {
				content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
				isError: true,
			};
		}
	},
});
