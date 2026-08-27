/**
 * The built-in tool roster, and the type derived from it.
 *
 * Type and constant live together so the two cannot drift: `CodingToolName` is derived from
 * `codingToolNames` rather than declared alongside it. Lives in `tools/` because the roster describes
 * what this layer provides — the SDK facade re-exports the type as part of its public surface.
 */
export const codingToolNames = [
	"Read",
	"Write",
	"Edit",
	"Glob",
	"Grep",
	"Bash",
	"UpdateTodos",
	"SpawnAgent",
] as const;

export type CodingToolName = (typeof codingToolNames)[number];
