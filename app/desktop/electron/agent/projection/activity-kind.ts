import type { DesktopToolActivityKind } from "../../../shared/desktop-rpc";

/**
 * Presentation category per built-in tool name, used only when replaying a
 * persisted session. `activityKind` is presentation metadata resolved at
 * execution time, so it is never written into the transcript; a cold reload has
 * nothing but the tool name to go on.
 *
 * The Connector and MCP prefixes are transport namespaces, not verbs inferred
 * from a tool name. They remain stable on replay and identify remote calls even
 * after their original extension metadata is no longer in memory.
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
	if (toolName.startsWith("connector__") || toolName.startsWith("mcp__")) return "call";
	return BUILT_IN_ACTIVITY_KINDS[toolName] ?? "operation";
}
