import { defineAgentTool } from "@jayden/jai-agent";
import z from "zod";

const BINARY_EXTENSIONS = new Set([
	".jpg",
	".jpeg",
	".png",
	".gif",
	".bmp",
	".ico",
	".webp",
	".svg",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".mkv",
	".flac",
	".wav",
	".ogg",
	".zip",
	".tar",
	".gz",
	".bz2",
	".7z",
	".rar",
	".xz",
	".exe",
	".dll",
	".so",
	".dylib",
	".bin",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".pyc",
	".class",
	".o",
	".obj",
]);

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export const fileReadTool = defineAgentTool({
	name: "FileRead",
	label: "Read file",
	description: `Read file contents from disk. Always use this instead of Bash cat/head/tail.

IMPORTANT RULES:
- You MUST read a file before editing it with FileEdit or overwriting it with FileWrite.
- For files within the default limit (200 lines), omit offset/limit to read the entire file.
- For large files (>200 lines), first read without offset to see the beginning and total line count, then use offset to jump to specific sections.
- Binary files (images, archives, compiled files, etc.) are not supported — use Bash if you need to inspect them.
- Output includes a header with file path, line range, and total lines. Use this metadata to plan subsequent reads or edits.`,
	parameters: z.object({
		path: z.string().describe("File path (absolute or relative to cwd)"),
		offset: z.number().int().min(0).default(0).describe("Line offset to start reading from (0-indexed)"),
		limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe("Maximum number of lines to read"),
	}),
	validate(params) {
		if (!params.path.trim()) {
			return "Path must not be empty.";
		}
		const ext = params.path.slice(params.path.lastIndexOf(".")).toLowerCase();
		if (BINARY_EXTENSIONS.has(ext)) {
			return `Binary file not supported: ${params.path} (extension: ${ext}). Use Bash to inspect binary files if needed.`;
		}
	},
	async execute(params) {
		const { path, offset, limit } = params;
		const effectiveLimit = Math.min(limit, MAX_LIMIT);

		try {
			const file = Bun.file(path);
			if (!(await file.exists())) {
				return { content: [{ type: "text" as const, text: `Error: File not found: ${path}` }], isError: true };
			}

			const raw = await file.text();
			const allLines = raw.split("\n");
			const totalLines = allLines.length;
			const sliced = allLines.slice(offset, offset + effectiveLimit);
			const endLine = offset + sliced.length;
			const remaining = totalLines - endLine;

			const header = `// File: ${path} (lines ${offset + 1}–${endLine} of ${totalLines})`;
			const parts = [header, sliced.join("\n")];

			if (remaining > 0) {
				parts.push(`\n[${remaining} more lines. Use offset=${endLine} to continue reading.]`);
			}

			return { content: [{ type: "text" as const, text: parts.join("\n") }] };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("permission denied") || msg.includes("EACCES")) {
				return { content: [{ type: "text" as const, text: `Error: Permission denied: ${path}` }], isError: true };
			}
			return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
		}
	},
});
