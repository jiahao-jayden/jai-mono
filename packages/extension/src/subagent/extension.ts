import { type CodingAgentExtension, defineExtension } from "@jai/coding-agent";
import { Type } from "@sinclair/typebox";
import { Result, TaggedError } from "better-result";

class SubagentConcurrencyLimit extends TaggedError("coding_subagent.concurrency_limit")<{ readonly message: string }> {}
class SubagentInvalidTask extends TaggedError("coding_subagent.invalid_task")<{ readonly message: string }> {}
class SubagentRunFailed extends TaggedError("coding_subagent.run_failed")<{ readonly message: string }> {}
class SubagentNoFinalText extends TaggedError("coding_subagent.no_final_text")<{ readonly message: string }> {}

export function createSubagentExtension(): CodingAgentExtension<{}, {}, { active: number }> {
	return defineExtension({
		id: "jai.subagent",
		lifecycle: { activate: () => Result.ok({ active: 0 }) },
		tools: [
			{
				name: "SpawnAgent",
				description:
					"Delegate one independent task to an isolated subagent and wait for its final result. The task must include all required context because the subagent cannot see the parent transcript. Emit multiple independent SpawnAgent calls together when they can run in parallel.",
				parameters: Type.Object(
					{
						title: Type.String({
							minLength: 1,
							maxLength: 80,
							description: "Concise user-visible title, at most six words.",
						}),
						task: Type.String({
							minLength: 1,
							maxLength: 20000,
							description: "Self-contained task with all context the subagent needs.",
						}),
					},
					{ additionalProperties: false },
				),
				authorization: { owner: "extension" },
				presentation: { title: (_runtime, args) => (typeof args.title === "string" ? args.title : "SpawnAgent") },
				executionMode: "parallel",
				async execute(runtime, call) {
					call.signal?.throwIfAborted();
					const title = (call.args.title as string).trim();
					const task = (call.args.task as string).trim();
					if (!title || !task) throw new SubagentInvalidTask({ message: "Title and task must not be blank" });
					if (runtime.instance.active >= 4)
						throw new SubagentConcurrencyLimit({ message: "At most 4 subagents can run concurrently" });
					runtime.instance.active++;
					let activityTitle: string | undefined;
					const update = (status: "running" | "complete" | "error") => {
						const details = { title, status, ...(activityTitle ? { activityTitle } : {}) };
						call.onUpdate?.({ content: [], details });
						return details;
					};
					try {
						update("running");
						const result = await call.runAgent({
							prompt: task,
							instructions:
								"You are an internal subagent. Complete only the delegated task using the available tools, then return a concise final result to the parent agent. You cannot see the parent conversation, so rely only on the task and workspace.",
							excludeTools: ["SpawnAgent", "UpdateTodos"],
							onActivity(next) {
								if (activityTitle === next) return;
								activityTitle = next;
								update("running");
							},
						});
						if (result.isErr()) throw new SubagentRunFailed({ message: result.error.message });
						const last = result.value.findLast((message) => message.role === "assistant");
						const text =
							last?.role === "assistant"
								? last.content
										.filter((part) => part.type === "text")
										.map((part) => part.text)
										.join("")
										.trim()
								: "";
						if (!text) throw new SubagentNoFinalText({ message: "Subagent completed without a final response" });
						return { content: [{ type: "text", text }], details: update("complete") };
					} catch (error) {
						update("error");
						throw error;
					} finally {
						runtime.instance.active--;
					}
				},
			},
		],
	});
}
