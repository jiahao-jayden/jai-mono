/**
 * A Coding Agent's user-facing description of a tool execution. It belongs to
 * the SDK projection, never to the provider-neutral tool or Agent loop.
 */
export type CodingToolActivityKind = "search" | "read" | "write" | "execute" | "call" | "operation";

export interface CodingToolPresentation {
	readonly activityKind?: CodingToolActivityKind;
	readonly title?: (args: unknown) => string;
	readonly resolveActivityKind?: (args: unknown) => CodingToolActivityKind | undefined;
}

export interface ResolvedCodingToolPresentation {
	readonly activityKind: CodingToolActivityKind;
	readonly title: string;
}

export function builtInToolPresentations(): ReadonlyMap<string, CodingToolPresentation> {
	const presentations: readonly (readonly [string, CodingToolPresentation])[] = [
		["Read", { activityKind: "read", title: (args) => `Read ${stringArgument(args, "path") ?? "file"}` }],
		["Write", { activityKind: "write", title: (args) => `Write ${stringArgument(args, "path") ?? "file"}` }],
		["Edit", { activityKind: "write", title: (args) => `Edit ${stringArgument(args, "path") ?? "file"}` }],
		["Bash", { activityKind: "execute", title: (args) => `Run ${stringArgument(args, "command") ?? "command"}` }],
		["UpdateTodos", { title: () => "Updating progress" }],
		["SpawnAgent", { title: (args) => stringArgument(args, "title") ?? "SpawnAgent" }],
		["SearchTools", { activityKind: "search" }],
	];
	return new Map(presentations);
}

export function resolveToolPresentation(
	toolName: string,
	args: unknown,
	presentation?: CodingToolPresentation,
): ResolvedCodingToolPresentation {
	const fallback: ResolvedCodingToolPresentation = { activityKind: "operation", title: toolName };
	if (!presentation) return fallback;
	const activityKind = resolveActivityKind(presentation, args) ?? presentation.activityKind ?? fallback.activityKind;
	return { activityKind, title: resolveTitle(presentation, args, fallback.title) };
}

function resolveActivityKind(presentation: CodingToolPresentation, args: unknown): CodingToolActivityKind | undefined {
	if (!presentation.resolveActivityKind) return undefined;
	try {
		return presentation.resolveActivityKind(args);
	} catch {
		return undefined;
	}
}

function resolveTitle(presentation: CodingToolPresentation, args: unknown, fallback: string): string {
	if (!presentation.title) return fallback;
	try {
		const title = presentation.title(args).trim() || fallback;
		return title.length > 80 ? `${title.slice(0, 79)}…` : title;
	} catch {
		return fallback;
	}
}

function stringArgument(args: unknown, key: string): string | undefined {
	if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}
