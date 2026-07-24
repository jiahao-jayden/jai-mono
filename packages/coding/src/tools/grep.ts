import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { AgentTool } from "@jai/agent";
import { type Static, Type } from "@sinclair/typebox";
import { collectMatches } from "../internal/ripgrep";
import { truncateText } from "../internal/truncate";
import { resolveWorkspacePath } from "../internal/workspace";
import type { CodingToolOptions, TruncationDetails } from "./types";

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

export function createGrepTool(options: CodingToolOptions): AgentTool<typeof grepParameters, GrepToolDetails> {
	return {
		name: "grep",
		label: "grep",
		description:
			"Search UTF-8 file contents with a regex. Supports include globs, literal matching, case folding, and context lines.",
		parameters: grepParameters,
		executionMode: "parallel",
		async execute(_toolCallId, args, signal) {
			const searchPath = await resolveWorkspacePath(options.cwd, args.path ?? ".", {
				mustExist: true,
				allowOutsideWorkspace: options.allowOutsideWorkspace,
			});
			const searchStats = await stat(searchPath);
			const cwd = searchStats.isDirectory() ? searchPath : dirname(searchPath);
			const target = searchStats.isDirectory() ? "." : basename(searchPath);
			const limit = args.limit ?? 100;
			const result = await collectMatches({
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

			const truncated = truncateText(result.lines.join("\n"));
			const wasTruncated = result.matchLimitReached || truncated.details !== undefined || truncated.linesTruncated;
			let text = truncated.content;
			if (result.matchLimitReached) {
				text += `\n\n[Match limit ${limit} reached. Refine the pattern or increase limit.]`;
			} else if (truncated.details) {
				text += "\n\n[Output truncated by size. Refine the pattern or path.]";
			}

			return {
				content: [{ type: "text", text }],
				details: {
					matches: result.matches,
					truncated: wasTruncated,
					matchLimitReached: result.matchLimitReached ? limit : undefined,
					linesTruncated: truncated.linesTruncated || undefined,
					truncation: truncated.details,
				},
			};
		},
	};
}
