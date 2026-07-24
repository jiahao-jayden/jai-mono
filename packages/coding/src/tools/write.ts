import type { AgentTool } from "@jai/agent";
import { type Static, Type } from "@sinclair/typebox";
import { atomicWrite } from "../internal/atomic-write";
import { withFileMutationQueue } from "../internal/file-mutation-queue";
import { resolveWorkspacePath } from "../internal/workspace";
import type { CodingToolOptions } from "./types";

const writeParameters = Type.Object(
	{
		path: Type.String(),
		content: Type.String(),
	},
	{ additionalProperties: false },
);

export type WriteToolInput = Static<typeof writeParameters>;

export interface WriteToolDetails {
	path: string;
	bytes: number;
	created: boolean;
}

export function createWriteTool(options: CodingToolOptions): AgentTool<typeof writeParameters, WriteToolDetails> {
	return {
		name: "write",
		label: "write",
		description: "Create or completely overwrite a UTF-8 text file. Parent directories are created automatically.",
		parameters: writeParameters,
		executionMode: "sequential",
		async execute(_toolCallId, args, signal) {
			const absolutePath = await resolveWorkspacePath(options.cwd, args.path, {
				mustExist: false,
				expectedType: "file",
				allowOutsideWorkspace: options.allowOutsideWorkspace,
			});

			return withFileMutationQueue(absolutePath, async () => {
				const { created } = await atomicWrite(absolutePath, args.content, signal);
				const bytes = Buffer.byteLength(args.content, "utf8");
				return {
					content: [
						{
							type: "text",
							text: `${created ? "Created" : "Wrote"} ${bytes} bytes to ${args.path}`,
						},
					],
					details: {
						path: absolutePath,
						bytes,
						created,
					},
				};
			});
		},
	};
}
