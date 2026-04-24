import {
	CheckListIcon,
	File02Icon,
	FileEditIcon,
	FileSearchIcon,
	FolderSearchIcon,
	Globe02Icon,
	Search01Icon,
	TerminalIcon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export const TOOL_DISPLAY_NAME: Record<string, string> = {
	WebSearch: "Search",
	WebFetch: "Fetch",
	Bash: "Run",
	FileRead: "Read",
	FileWrite: "Write",
	FileEdit: "Edit",
	Grep: "Grep",
	Glob: "Glob",
	TodoWrite: "Todo",
};

export const TOOL_ICON: Record<string, IconSvgElement> = {
	WebSearch: Search01Icon,
	WebFetch: Globe02Icon,
	Bash: TerminalIcon,
	FileRead: File02Icon,
	FileWrite: FileEditIcon,
	FileEdit: FileEditIcon,
	Grep: FileSearchIcon,
	Glob: FolderSearchIcon,
	TodoWrite: CheckListIcon,
};

export function getToolIcon(toolName: string): IconSvgElement {
	return TOOL_ICON[toolName] ?? Wrench01Icon;
}

export function getToolDisplayName(toolName: string): string {
	return TOOL_DISPLAY_NAME[toolName] ?? toolName;
}
