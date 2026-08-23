import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool } from "../../core";
import { withFileMutationQueue } from "./file-mutation-queue";
import { byteLength } from "./truncate";
import type { WorkspaceToolOptions } from "./types";

const writeParameters = Type.Object({ path: Type.String(), content: Type.String() }, { additionalProperties: false });

export type WriteToolInput = Static<typeof writeParameters>;
export interface WriteToolDetails {
	path: string;
	bytes: number;
	created: boolean;
}

export function createWriteTool(options: WorkspaceToolOptions): AgentTool<typeof writeParameters, WriteToolDetails> {
	return {
		name: "Write",
		description: "Create or completely overwrite a UTF-8 text file. Parent directories are created automatically.",
		parameters: writeParameters,
		executionMode: "sequential",
		async execute(_toolCallId, args, signal) {
			const resolved = await options.fileSystem.resolvePath(args.path, {
				base: options.workspaceRoot,
				boundary: options.workspaceRoot,
				mustExist: false,
				expectedKind: "file",
				signal,
			});
			return withFileMutationQueue(options.fileSystem, resolved.canonicalPath, async () => {
				const { created } = await options.fileSystem.writeFileAtomic(resolved.path, args.content, { signal });
				const bytes = byteLength(args.content);
				return {
					content: [
						{
							type: "text",
							text: `${created ? "Created" : "Wrote"} ${bytes} bytes to ${args.path}`,
						},
					],
					details: { path: resolved.path, bytes, created },
				};
			});
		},
	};
}
