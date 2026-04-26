import { type AgentTool, defineAgentTool } from "@jayden/jai-agent";
import z from "zod";

const MAX_RESULTS = 100;

export function globTool(defaultCwd: string): AgentTool {
	return defineAgentTool({
		name: "Glob",
		label: "Find files",
		description: `Find files by name/path pattern. Always use this instead of Bash find.

WHEN TO USE:
- Discovering project structure before diving into code.
- Locating files by name or extension (e.g. config files, test files, specific modules).
- Checking whether a file exists before reading it.

COMMON PATTERNS:
- "**/*.ts" → all TypeScript files
- "src/**/*.test.ts" → test files under src
- "**/package.json" → all package.json files
- "**/*.{ts,tsx}" → multiple extensions

RULES:
- Results are capped at ${MAX_RESULTS} files. If too many results, use a more specific pattern or add directory prefixes.
- Results are sorted alphabetically. Use the output to plan which files to read.
- node_modules and .git are not automatically excluded — prefix your pattern with a directory if you want to scope results (e.g. "src/**/*.ts" instead of "**/*.ts").`,
		parameters: z.object({
			pattern: z.string().describe('Glob pattern, e.g. "**/*.ts"'),
			cwd: z.string().optional().describe("Search root directory (defaults to workspace cwd)"),
		}),
		validate(params) {
			if (!params.pattern.trim()) {
				return "Pattern must not be empty.";
			}
			if (!params.pattern.includes("*") && !params.pattern.includes("?")) {
				return `Pattern "${params.pattern}" contains no wildcards (* or ?). To read a specific file, use FileRead instead.`;
			}
		},
		async execute(params) {
			const { pattern, cwd: overrideCwd } = params;
			const cwd = overrideCwd ?? defaultCwd;

			try {
				const glob = new Bun.Glob(pattern);
				const allFiles: string[] = [];

				for await (const file of glob.scan({ cwd, onlyFiles: true })) {
					allFiles.push(file);
					if (allFiles.length > MAX_RESULTS * 10) break;
				}

				allFiles.sort();

				if (allFiles.length === 0) {
					return {
						content: [{ type: "text" as const, text: `No files found matching ${pattern} in ${cwd}` }],
					};
				}

				const total = allFiles.length;
				const shown = allFiles.slice(0, MAX_RESULTS);

				const parts: string[] = [];
				if (total > MAX_RESULTS) {
					parts.push(`Found ${total} files matching ${pattern} (showing first ${MAX_RESULTS}):`);
				} else {
					parts.push(`Found ${total} file${total > 1 ? "s" : ""} matching ${pattern}:`);
				}
				parts.push(shown.join("\n"));

				if (total > MAX_RESULTS) {
					parts.push(
						`\n[${total - MAX_RESULTS} more files not shown. Use a more specific pattern to narrow results.]`,
					);
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
}
