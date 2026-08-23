import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool } from "../../core";
import { truncateText } from "./truncate";
import type { SearchToolOptions, TruncationDetails } from "./types";

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

export function createGlobTool(options: SearchToolOptions): AgentTool<typeof globParameters, GlobToolDetails> {
	return {
		name: "Glob",
		description:
			"Find files by glob pattern. Respects .gitignore and returns paths relative to the search directory.",
		parameters: globParameters,
		executionMode: "parallel",
		async execute(_toolCallId, args, signal) {
			const searchPath = await options.fileSystem.resolvePath(args.path ?? ".", {
				base: options.workspaceRoot,
				boundary: options.workspaceRoot,
				mustExist: true,
				expectedKind: "directory",
				signal,
			});
			const limit = args.limit ?? 100;
			const result = await options.fileSearch.glob({
				cwd: searchPath.path,
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
			const wasTruncated = result.limitReached || truncated.details !== undefined;
			let text = truncated.content;
			if (result.limitReached) {
				text += `\n\n[Result limit ${limit} reached. Use a more specific pattern or path.]`;
			} else if (truncated.details) {
				text += "\n\n[Output truncated by size. Use a more specific pattern or path.]";
			}
			return {
				content: [{ type: "text", text }],
				details: {
					count: result.paths.length,
					truncated: wasTruncated,
					resultLimitReached: result.limitReached ? limit : undefined,
					truncation: truncated.details,
				},
			};
		},
	};
}
