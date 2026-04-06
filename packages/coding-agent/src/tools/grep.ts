import { defineAgentTool } from "@jayden/jai-agent";
import z from "zod";

const DEFAULT_LIMIT = 50;

type GrepMatch = {
	file: string;
	line: number;
	text: string;
};

function parseGrepOutput(output: string): GrepMatch[] {
	const matches: GrepMatch[] = [];
	for (const line of output.split("\n")) {
		if (!line) continue;
		// Format: file:line:text (from grep -rn / rg --no-heading -n)
		const m = line.match(/^(.+?):(\d+):(.*)$/);
		if (m) {
			matches.push({ file: m[1], line: Number(m[2]), text: m[3] });
		}
	}
	return matches;
}

export const grepTool = defineAgentTool({
	name: "Grep",
	label: "Search content",
	description: `Search file contents for a text pattern (string or regex). Prefer this over bash grep/rg.
Returns matching lines with file paths and line numbers.
Supports pagination with offset/limit for large result sets.
Use file_pattern to restrict search to specific file types (e.g. "*.ts").`,
	parameters: z.object({
		pattern: z.string().describe("Search pattern (text or regex)"),
		path: z.string().describe("File or directory to search in"),
		recursive: z.boolean().default(true).describe("Recursively search directories"),
		case_sensitive: z.boolean().default(false).describe("Case-sensitive matching"),
		file_pattern: z.string().optional().describe('Limit to file types, e.g. "*.ts"'),
		offset: z.number().int().min(0).default(0).describe("Skip first N results"),
		limit: z.number().int().min(1).default(DEFAULT_LIMIT).describe("Maximum results to return"),
	}),
	validate(params) {
		if (!params.pattern.trim()) {
			return "Pattern must not be empty.";
		}
		if (!params.path.trim()) {
			return "Path must not be empty.";
		}
	},
	async execute(params) {
		const { pattern, path, recursive, case_sensitive, file_pattern, offset, limit } = params;

		try {
			// Prefer ripgrep, fall back to grep
			const hasRg = await checkCommand("rg");
			const args = hasRg
				? buildRgArgs(pattern, path, recursive, case_sensitive, file_pattern)
				: buildGrepArgs(pattern, path, recursive, case_sensitive, file_pattern);

			const cmd = hasRg ? "rg" : "grep";
			const proc = Bun.spawn([cmd, ...args], {
				stdout: "pipe",
				stderr: "pipe",
			});

			const stdout = await new Response(proc.stdout).text();
			const stderr = await new Response(proc.stderr).text();
			const exitCode = await proc.exited;

			// exit code 1 = no matches (not an error for grep/rg)
			if (exitCode > 1) {
				return {
					content: [
						{ type: "text" as const, text: `Error: ${stderr.trim() || `${cmd} exited with code ${exitCode}`}` },
					],
					isError: true,
				};
			}

			const allMatches = parseGrepOutput(stdout);
			const total = allMatches.length;

			if (total === 0) {
				return {
					content: [{ type: "text" as const, text: `No matches found for "${pattern}" in ${path}` }],
				};
			}

			const sliced = allMatches.slice(offset, offset + limit);
			const endIdx = offset + sliced.length;

			const parts: string[] = [];
			if (total > limit || offset > 0) {
				parts.push(`Found ${total} matches (showing ${offset + 1}–${endIdx}):`);
			} else {
				parts.push(`Found ${total} match${total > 1 ? "es" : ""} for "${pattern}" in ${path}:`);
			}

			parts.push("");
			for (const m of sliced) {
				parts.push(`${m.file}:${m.line}: ${m.text}`);
			}

			if (endIdx < total) {
				parts.push(`\n[${total - endIdx} more matches. Use offset=${endIdx} to see more.]`);
			}

			return { content: [{ type: "text" as const, text: parts.join("\n") }] };
		} catch (err) {
			return {
				content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
				isError: true,
			};
		}
	},
});

async function checkCommand(cmd: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

function buildRgArgs(
	pattern: string,
	path: string,
	recursive: boolean,
	caseSensitive: boolean,
	filePattern?: string,
): string[] {
	const args = ["--no-heading", "-n"];
	if (!caseSensitive) args.push("-i");
	if (!recursive) args.push("--max-depth", "1");
	if (filePattern) args.push("-g", filePattern);
	args.push("--", pattern, path);
	return args;
}

function buildGrepArgs(
	pattern: string,
	path: string,
	recursive: boolean,
	caseSensitive: boolean,
	filePattern?: string,
): string[] {
	const args = ["-n"];
	if (!caseSensitive) args.push("-i");
	if (recursive) args.push("-r");
	if (filePattern) args.push("--include", filePattern);
	args.push("--", pattern, path);
	return args;
}
