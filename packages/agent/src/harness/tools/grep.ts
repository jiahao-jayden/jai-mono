import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool } from "../../core";
import { truncateText } from "./truncate";
import type { SearchToolOptions, TruncationDetails } from "./types";

const grepParameters = Type.Object(
	{
		pattern: Type.String({ minLength: 1 }),
		path: Type.Optional(Type.String()),
		include: Type.Optional(Type.String()),
		ignoreCase: Type.Optional(Type.Boolean()),
		literal: Type.Optional(Type.Boolean()),
		context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
	},
	{ additionalProperties: false },
);

export type GrepToolInput = Static<typeof grepParameters>;
export interface GrepToolDetails {
	matches: number;
	truncated: boolean;
	matchLimitReached?: number;
	linesTruncated?: boolean;
	truncation?: TruncationDetails;
}

export function createGrepTool(options: SearchToolOptions): AgentTool<typeof grepParameters, GrepToolDetails> {
	return {
		name: "Grep",
		label: "Grep",
		description:
			"Search UTF-8 file contents with a regex. Supports include globs, literal matching, case folding, and context lines.",
		parameters: grepParameters,
		executionMode: "parallel",
		async execute(_toolCallId, args, signal) {
			const searchPath = await options.fileSystem.resolvePath(args.path ?? ".", {
				base: options.workspaceRoot,
				boundary: options.workspaceRoot,
				mustExist: true,
				signal,
			});
			const stats = await options.fileSystem.stat(searchPath.path, { signal });
			const slash = Math.max(searchPath.path.lastIndexOf("/"), searchPath.path.lastIndexOf("\\"));
			const cwd = stats.kind === "directory" ? searchPath.path : searchPath.path.slice(0, slash);
			const target = stats.kind === "directory" ? "." : searchPath.path.slice(slash + 1);
			const limit = args.limit ?? 100;
			const result = await options.fileSearch.grep({
				cwd,
				target,
				pattern: args.pattern,
				include: args.include,
				ignoreCase: args.ignoreCase,
				literal: args.literal,
				context: args.context,
				limit,
				signal,
			});
			if (result.matches === 0) {
				return {
					content: [{ type: "text", text: "No matches found" }],
					details: { matches: 0, truncated: false },
				};
			}
			const lines = result.rows.map((row) => {
				const separator = row.kind === "match" ? ":" : "-";
				return `${row.path}${separator}${row.line}${separator} ${row.text}`;
			});
			const truncated = truncateText(lines.join("\n"));
			const wasTruncated = result.limitReached || truncated.details !== undefined || truncated.linesTruncated;
			let text = truncated.content;
			if (result.limitReached) {
				text += `\n\n[Match limit ${limit} reached. Refine the pattern or increase limit.]`;
			} else if (truncated.details) {
				text += "\n\n[Output truncated by size. Refine the pattern or path.]";
			}
			return {
				content: [{ type: "text", text }],
				details: {
					matches: result.matches,
					truncated: wasTruncated,
					matchLimitReached: result.limitReached ? limit : undefined,
					linesTruncated: truncated.linesTruncated || undefined,
					truncation: truncated.details,
				},
			};
		},
	};
}
