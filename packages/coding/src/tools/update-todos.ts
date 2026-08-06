import type { AgentTool } from "@jai/agent";
import { Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";

export const UPDATE_TODOS_TOOL_NAME = "UpdateTodos";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface SessionTodoItem {
	readonly id: string;
	readonly content: string;
	readonly status: TodoStatus;
}

export interface SessionTodos {
	readonly version: 1;
	readonly updatedAt: number;
	readonly items: readonly SessionTodoItem[];
}

export interface UpdateTodosToolDetails {
	readonly todos: SessionTodos;
}

export type ReplaceSessionTodos = (items: readonly SessionTodoItem[]) => Promise<SessionTodos>;

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

const todoItemSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }),
		content: Type.String({ minLength: 1, maxLength: 200 }),
		status: Type.Union([
			Type.Literal("pending"),
			Type.Literal("in_progress"),
			Type.Literal("completed"),
			Type.Literal("cancelled"),
		]),
	},
	{ additionalProperties: false },
);

const updateTodosParameters = Type.Object(
	{
		todos: Type.Array(todoItemSchema, { maxItems: 20 }),
	},
	{ additionalProperties: false },
);

export function createUpdateTodosTool(
	replaceTodos: ReplaceSessionTodos,
): AgentTool<typeof updateTodosParameters, UpdateTodosToolDetails> {
	return {
		name: UPDATE_TODOS_TOOL_NAME,
		title: () => "Updating progress",
		description:
			"Replace the current session Todo list after a meaningful plan or progress change. Use stable IDs, keep at most one item in progress, and mark work completed only after its required verification succeeds.",
		parameters: updateTodosParameters,
		executionMode: "sequential",
		async execute(_toolCallId, input, signal) {
			signal?.throwIfAborted();
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
			const todos = await replaceTodos(normalizedItems);
			return {
				content: [{ type: "text", text: "Todo list updated." }],
				details: { todos },
			};
		},
	};
}
