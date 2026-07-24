import type { AgentTool } from "@jai/agent";
import { type Static, Type } from "@sinclair/typebox";
import { collectFilePaths } from "../internal/ripgrep";
import { truncateText } from "../internal/truncate";
import { resolveWorkspacePath } from "../internal/workspace";
import type { CodingToolOptions, TruncationDetails } from "./types";

const globParameters = Type.Object(
	{
		pattern: Type.String(),
		path: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
	},
	{ additionalProperties: false },
);

export type GlobToolInput = Static<typeof globParameters>;

export interface GlobToolDetails {
	count: number;
	truncated: boolean;
	resultLimitReached?: number;
	truncation?: TruncationDetails;
}

export function createGlobTool(options: CodingToolOptions): AgentTool<typeof globParameters, GlobToolDetails> {
	return {
		name: "glob",
		label: "glob",
		description:
			"Find files by glob pattern. Respects .gitignore and returns paths relative to the search directory.",
		parameters: globParameters,
		executionMode: "parallel",
		async execute(_toolCallId, args, signal) {
			const searchPath = await resolveWorkspacePath(options.cwd, args.path ?? ".", {
				mustExist: true,
				expectedType: "directory",
				allowOutsideWorkspace: options.allowOutsideWorkspace,
			});
			const limit = args.limit ?? 100;
			const result = await collectFilePaths({
				cwd: searchPath,
				pattern: args.pattern,
				limit,
				signal,
			});
			result.paths.sort((a, b) => a.localeCompare(b));

			if (result.paths.length === 0) {
				return {
					content: [{ type: "text", text: "No files found" }],
					details: { count: 0, truncated: false },
				};
			}

			const truncated = truncateText(result.paths.join("\n"));
			const wasTruncated = result.resultLimitReached || truncated.details !== undefined;
			let text = truncated.content;
			if (result.resultLimitReached) {
				text += `\n\n[Result limit ${limit} reached. Use a more specific pattern or path.]`;
			} else if (truncated.details) {
				text += "\n\n[Output truncated by size. Use a more specific pattern or path.]";
			}

			return {
				content: [{ type: "text", text }],
				details: {
					count: result.paths.length,
					truncated: wasTruncated,
					resultLimitReached: result.resultLimitReached ? limit : undefined,
					truncation: truncated.details,
				},
			};
		},
	};
}
