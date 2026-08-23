import type { AgentTool } from "@jai/agent";
import { getErrorMessage } from "@jai/common";
import { Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";

export const SPAWN_AGENT_TOOL_NAME = "SpawnAgent";
export const MAX_CONCURRENT_SUBAGENTS = 4;

export interface SpawnAgentToolDetails {
	readonly title: string;
	readonly status: "running" | "complete" | "error";
	readonly activityTitle?: string;
}

export interface SpawnAgentRunInput {
	readonly title: string;
	readonly task: string;
	readonly signal?: AbortSignal;
	readonly onActivity: (title: string) => void;
}

export type SpawnAgentRunner = (input: SpawnAgentRunInput) => Promise<string>;

type SubagentErrorInit = {
	readonly cause?: unknown;
	readonly data?: { readonly limit?: number; readonly title: string };
	readonly message: string;
};

class SubagentConcurrencyLimit extends TaggedError("coding_subagent.concurrency_limit")<SubagentErrorInit> {}
class SubagentNoFinalText extends TaggedError("coding_subagent.no_final_text")<SubagentErrorInit> {}
class SubagentRunFailed extends TaggedError("coding_subagent.run_failed")<SubagentErrorInit> {}

const spawnAgentParameters = Type.Object(
	{
		title: Type.String({
			minLength: 1,
			maxLength: 80,
			description: "Concise user-visible title, at most six words.",
		}),
		task: Type.String({
			minLength: 1,
			maxLength: 20_000,
			description: "Self-contained task with all context the subagent needs.",
		}),
	},
	{ additionalProperties: false },
);

export function createSpawnAgentTool(
	run: SpawnAgentRunner,
): AgentTool<typeof spawnAgentParameters, SpawnAgentToolDetails> {
	let activeCount = 0;

	return {
		name: SPAWN_AGENT_TOOL_NAME,
		description:
			"Delegate one independent task to an isolated subagent and wait for its final result. The task must include all required context because the subagent cannot see the parent transcript. Emit multiple independent SpawnAgent calls together when they can run in parallel.",
		parameters: spawnAgentParameters,
		executionMode: "parallel",
		async execute(_toolCallId, input, signal, onUpdate) {
			signal?.throwIfAborted();
			const title = input.title.trim();
			const task = input.task.trim();
			if (activeCount >= MAX_CONCURRENT_SUBAGENTS) {
				throw new SubagentConcurrencyLimit({
					message: `At most ${MAX_CONCURRENT_SUBAGENTS} subagents can run concurrently`,
					data: { title, limit: MAX_CONCURRENT_SUBAGENTS },
				});
			}

			activeCount++;
			let activityTitle: string | undefined;
			const update = (status: SpawnAgentToolDetails["status"]) => {
				onUpdate?.({
					content: [],
					details: { title, status, ...(activityTitle ? { activityTitle } : {}) },
				});
			};
			update("running");

			try {
				const finalText = (
					await run({
						title,
						task,
						signal,
						onActivity(nextTitle) {
							if (activityTitle === nextTitle) return;
							activityTitle = nextTitle;
							update("running");
						},
					})
				).trim();
				if (!finalText) {
					throw new SubagentNoFinalText({
						message: "Subagent completed without a final response",
						data: { title },
					});
				}
				update("complete");
				return {
					content: [{ type: "text", text: finalText }],
					details: { title, status: "complete", ...(activityTitle ? { activityTitle } : {}) },
				};
			} catch (error) {
				update("error");
				if (signal?.aborted) throw error;
				if (error instanceof SubagentNoFinalText) throw error;
				throw new SubagentRunFailed({
					message: getErrorMessage(error),
					cause: error,
					data: { title },
				});
			} finally {
				activeCount--;
			}
		},
	};
}
