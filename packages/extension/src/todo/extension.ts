import { type CodingAgentExtension, defineExtension } from "@jai/coding-agent";
import { Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";
import { TODO_EXTENSION_ID, todoItemSchema, todoStateSchema, type TodoItem, type TodoState } from "./state.js";

class TodoDuplicateId extends TaggedError("coding_todo.duplicate_id")<{
	readonly data: { readonly id: string };
	readonly message: string;
}> {}
class TodoTooManyInProgress extends TaggedError("coding_todo.too_many_in_progress")<{
	readonly message: string;
}> {}
class TodoInvalidContent extends TaggedError("coding_todo.invalid_content")<{
	readonly data: { readonly id: string };
	readonly message: string;
}> {}

export function createTodoExtension(): CodingAgentExtension<{}, TodoState> {
	return defineExtension({
		id: TODO_EXTENSION_ID,
		sessionState: { schema: todoStateSchema, defaultValue: { version: 1, updatedAt: 0, items: [] } },
		tools: [
			{
				name: "UpdateTodos",
				description:
					"Replace the current session Todo list after a meaningful plan or progress change. Use stable IDs, keep at most one item in progress, and mark work completed only after its required verification succeeds.",
				parameters: Type.Object(
					{ todos: Type.Array(todoItemSchema, { maxItems: 20 }) },
					{ additionalProperties: false },
				),
				authorization: { owner: "extension" },
				presentation: { title: () => "Updating progress" },
				executionMode: "sequential",
				async execute(runtime, call) {
					call.signal?.throwIfAborted();
					const input = call.args as { todos: TodoItem[] };
					const seen = new Set<string>();
					let inProgressCount = 0;
					const normalizedItems = input.todos.map((item) => ({ ...item, content: item.content.trim() }));
					for (const item of normalizedItems) {
						if (!item.content) {
							throw new TodoInvalidContent({
								message: `Todo "${item.id}" must have non-empty content`,
								data: { id: item.id },
							});
						}
						if (seen.has(item.id)) {
							throw new TodoDuplicateId({
								message: `Todo ID "${item.id}" must be unique`,
								data: { id: item.id },
							});
						}
						seen.add(item.id);
						if (item.status === "in_progress") inProgressCount++;
					}
					if (inProgressCount > 1) {
						throw new TodoTooManyInProgress({ message: "Only one Todo item can be in progress" });
					}
					const updated = await runtime.sessionState.update(() => ({
						version: 1,
						updatedAt: Date.now(),
						items: normalizedItems,
					}));
					if (updated.isErr()) throw updated.error;
					return { content: [{ type: "text", text: "Todo list updated." }], details: { todos: updated.value } };
				},
			},
		],
		hooks: {
			beforeModelCall(runtime) {
				const state = runtime.sessionState.value;
				if (state.updatedAt === 0) return undefined;
				return {
					context: `Current session Todo state (internal state data, not a new user request):\n${JSON.stringify(state.items)}`,
				};
			},
		},
	});
}
