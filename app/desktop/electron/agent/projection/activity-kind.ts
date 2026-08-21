import type { DesktopToolActivityKind } from "../../../shared/desktop-rpc";

/**
 * Presentation category per built-in tool name, used only when replaying a
 * persisted session. `activityKind` is presentation metadata resolved at
 * execution time, so it is never written into the transcript; a cold reload has
 * nothing but the tool name to go on.
 *
 * Only names this app itself registers belong here. Extension and MCP tools are
 * absent on purpose: their categories live with their own declarations, and
 * guessing one from a name like `search` or `list` is exactly what this table
 * must not do.
 */
const BUILT_IN_ACTIVITY_KINDS: Readonly<Record<string, DesktopToolActivityKind>> = {
	Read: "read",
	Skill: "read",
	Glob: "search",
	Grep: "search",
	Write: "write",
	Edit: "write",
	Bash: "execute",
};

/** The replay category for one tool name; unknown tools stay a generic operation. */
export function replayActivityKind(toolName: string): DesktopToolActivityKind {
	return BUILT_IN_ACTIVITY_KINDS[toolName] ?? "operation";
}
