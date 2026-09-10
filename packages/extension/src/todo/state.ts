import type { JsonObject } from "@jai/coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const TODO_EXTENSION_ID = "jai.todo";
export const todoItemSchema = Type.Object(
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

export const todoStateSchema = Type.Object(
	{
		version: Type.Literal(1),
		updatedAt: Type.Number({ minimum: 0 }),
		items: Type.Array(todoItemSchema, { maxItems: 20 }),
	},
	{ additionalProperties: false },
);
export type TodoItem = Static<typeof todoItemSchema>;
export type TodoState = Static<typeof todoStateSchema>;

/** Read-only projection of the Todo Extension's journal state. */
export function todosFromExtensionState(extensions: JsonObject): TodoState | undefined {
	const value = extensions[TODO_EXTENSION_ID];
	if (!Value.Check(todoStateSchema, value)) return undefined;
	return {
		version: 1,
		updatedAt: value.updatedAt,
		items: value.items.map(({ id, content, status }) => ({ id, content, status })),
	};
}
