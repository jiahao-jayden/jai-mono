import {
	FilePenIcon,
	FileTextIcon,
	FolderSearchIcon,
	GlobeIcon,
	ListTodoIcon,
	type LucideIcon,
	ScanTextIcon,
	SearchIcon,
	TerminalIcon,
	WrenchIcon,
} from "lucide-react";

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

export const TOOL_ICON: Record<string, LucideIcon> = {
	WebSearch: SearchIcon,
	WebFetch: GlobeIcon,
	Bash: TerminalIcon,
	FileRead: FileTextIcon,
	FileWrite: FilePenIcon,
	FileEdit: FilePenIcon,
	Grep: ScanTextIcon,
	Glob: FolderSearchIcon,
	TodoWrite: ListTodoIcon,
};

export function getToolIcon(toolName: string): LucideIcon {
	return TOOL_ICON[toolName] ?? WrenchIcon;
}

export function getToolDisplayName(toolName: string): string {
	return TOOL_DISPLAY_NAME[toolName] ?? toolName;
}
