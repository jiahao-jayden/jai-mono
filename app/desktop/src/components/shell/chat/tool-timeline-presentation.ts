import type { IntlShape } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { IconName } from "@/lib/icon-context";
import type { DesktopNarrationItem, DesktopToolItem, DesktopWebSearchResult } from "../../../../shared/desktop-rpc";

export interface ToolTimelinePresentation {
	readonly icon: IconName;
	readonly title: string;
	readonly summary?: string;
	readonly details?: string;
	readonly webSearchResults?: readonly DesktopWebSearchResult[];
	readonly density: "compact" | "default";
}

export function resolveToolTimelinePresentation(
	narrations: readonly DesktopNarrationItem[],
	tools: readonly DesktopToolItem[],
	running: boolean,
	intl: IntlShape,
): ToolTimelinePresentation {
	const details = toolClusterDetails(narrations, tools, intl);
	const webSearchResults = tools.flatMap((tool) => tool.webSearchResults ?? []);
	const hasWebSearchResults = tools.some((tool) => tool.webSearchResults !== undefined);
	const firstTool = tools[0];
	if (!firstTool) {
		return {
			icon: "sparkles",
			density: "compact",
			title: intl.formatMessage(running ? desktopMessages.transcriptWorking : desktopMessages.transcriptWorked),
			summary: narrations.map((item) => item.text).join("\n\n"),
			...(details ? { details } : {}),
		};
	}

	const label = hasWebSearchResults ? webSearchLabel(tools, running, intl) : toolLabel(firstTool, running, intl);
	return {
		icon: toolIcon(firstTool, hasWebSearchResults),
		density: "compact",
		title: label,
		...(hasWebSearchResults ? {} : { summary: toolClusterChip(tools, intl) }),
		...(details ? { details } : {}),
		...(hasWebSearchResults ? { webSearchResults } : {}),
	};
}

function toolIcon(item: DesktopToolItem, webSearch: boolean): IconName {
	if (webSearch) return "globe";
	switch (item.activityKind) {
		case "search":
			return "search-code";
		case "read":
			return "file-search";
		case "write":
			return "file-edit";
		case "call":
			return "api";
		case "execute":
			return "command";
		case "operation":
			return "workflow";
	}
}

function toolLabel(item: DesktopToolItem, running: boolean, intl: IntlShape): string {
	switch (item.activityKind) {
		case "search":
			return intl.formatMessage(running ? desktopMessages.transcriptSearching : desktopMessages.transcriptSearched);
		case "read":
			return intl.formatMessage(running ? desktopMessages.transcriptReading : desktopMessages.transcriptRead);
		case "write":
			return intl.formatMessage(running ? desktopMessages.transcriptEditing : desktopMessages.transcriptEdited);
		case "call":
			return intl.formatMessage(running ? desktopMessages.transcriptCalling : desktopMessages.transcriptCalled);
		case "execute":
		case "operation":
			return intl.formatMessage(running ? desktopMessages.transcriptRunning : desktopMessages.transcriptRan);
	}
}

function humanizeToolName(toolName: string): string {
	const normalized = toolName.replace(/^[a-z]+__/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
	const words = normalized.split(/[_\s-]+/).filter(Boolean);
	return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function toolClusterChip(items: readonly DesktopToolItem[], intl: IntlShape): string {
	if (items.length === 1) return items[0]?.summary ?? humanizeToolName(items[0]?.toolName ?? "Tool");

	const category = items[0]?.activityKind;
	if (category === "search") return intl.formatMessage(desktopMessages.transcriptSearches, { count: items.length });
	if (category === "read" || category === "write") {
		return intl.formatMessage(desktopMessages.transcriptFiles, { count: items.length });
	}
	if (category === "execute") return intl.formatMessage(desktopMessages.transcriptCommands, { count: items.length });
	if (category === "call") return intl.formatMessage(desktopMessages.transcriptCalls, { count: items.length });
	return intl.formatMessage(desktopMessages.transcriptActions, { count: items.length });
}

function webSearchLabel(tools: readonly DesktopToolItem[], running: boolean, intl: IntlShape): string {
	const tool = tools.find((item) => item.webSearchResults !== undefined);
	if (!tool || isGenericWebSearchToolName(tool.toolName)) {
		const query = tool?.searchQuery;
		if (query) return query;
		return intl.formatMessage(
			running ? desktopMessages.transcriptWebSearching : desktopMessages.transcriptWebSearchResults,
		);
	}
	return tool.toolName;
}

function isGenericWebSearchToolName(value: string): boolean {
	return value.trim().toLowerCase().replaceAll(/[_-]/g, " ") === "web search";
}

function fileChangeVerb(operation: "add" | "modify" | "delete", intl: IntlShape): string {
	switch (operation) {
		case "add":
			return intl.formatMessage(desktopMessages.transcriptAdded);
		case "modify":
			return intl.formatMessage(desktopMessages.transcriptModified);
		case "delete":
			return intl.formatMessage(desktopMessages.transcriptDeleted);
	}
}

function toolClusterDetails(
	narrations: readonly DesktopNarrationItem[],
	tools: readonly DesktopToolItem[],
	intl: IntlShape,
): string | undefined {
	const narration = narrations.map((item) => item.text).join("\n\n");
	const toolDetails = tools
		.map((item) => {
			const summary = toolClusterChip([item], intl);
			const changedFiles = item.fileChanges
				?.map((change) => `${fileChangeVerb(change.operation, intl)} ${change.path}`)
				.join("\n");
			const details = [item.details, changedFiles].filter(Boolean).join("\n");
			const body = details ? `\n${details}` : "";
			return `${humanizeToolName(item.toolName)} · ${summary}${body}`;
		})
		.join("\n\n");
	return [narration, toolDetails].filter(Boolean).join("\n\n") || undefined;
}
