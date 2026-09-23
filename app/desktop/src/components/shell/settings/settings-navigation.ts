import type { MessageDescriptor } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { IconName } from "@/lib/icon-context";

export type SettingsCategory =
	| "general"
	| "profile"
	| "archived"
	| "providers"
	| "web-search"
	| "connector"
	| "mcp"
	| "advanced"
	| "logs";

export const settingsCategories: Record<
	SettingsCategory,
	{ label: MessageDescriptor; icon: IconName; keywords: readonly string[] }
> = {
	general: {
		label: desktopMessages.settingsGeneral,
		icon: "settings",
		keywords: ["language", "语言", "theme", "主题", "dark", "深色", "iterations", "迭代", "reasoning", "推理"],
	},
	profile: {
		label: desktopMessages.settingsProfile,
		icon: "analytics",
		keywords: ["token", "usage", "用量", "statistics", "统计", "heatmap", "热力图"],
	},
	archived: {
		label: desktopMessages.settingsArchivedChats,
		icon: "archive",
		keywords: ["archive", "归档", "chat", "对话", "session", "会话", "restore", "恢复"],
	},
	providers: {
		label: desktopMessages.settingsProviders,
		icon: "key",
		keywords: ["model", "模型", "provider", "api key", "密钥", "openai", "anthropic", "deepseek", "ollama"],
	},
	"web-search": {
		label: desktopMessages.settingsWebSearch,
		icon: "globe",
		keywords: ["search", "搜索", "web", "网页", "jina", "api key", "密钥"],
	},
	connector: {
		label: desktopMessages.settingsConnector,
		icon: "link",
		keywords: ["connector", "oauth", "授权", "integration", "集成", "account", "账号"],
	},
	mcp: {
		label: desktopMessages.settingsMcp,
		icon: "plug",
		keywords: ["mcp", "server", "服务器", "tool", "工具", "stdio"],
	},
	advanced: {
		label: desktopMessages.settingsAdvanced,
		icon: "layers",
		keywords: ["telemetry", "遥测", "langfuse", "trace", "追踪", "observability", "可观测"],
	},
	logs: {
		label: desktopMessages.settingsLogs,
		icon: "file-search",
		keywords: ["log", "日志", "debug", "调试", "error", "错误", "crash", "崩溃"],
	},
};

/** 分类名和关键词都参与匹配，这样搜「模型」也能找到服务商。 */
export function matchesSettingsCategory(id: SettingsCategory, label: string, query: string): boolean {
	if (!query) return true;
	if (label.toLowerCase().includes(query)) return true;
	return settingsCategories[id].keywords.some((keyword) => keyword.includes(query));
}

export const settingsCategoryGroups = [
	{
		label: desktopMessages.settingsTitle,
		categories: ["general", "profile", "archived", "logs"] as const,
	},
	{
		label: desktopMessages.settingsIntegrations,
		categories: ["providers", "web-search", "connector", "mcp", "advanced"] as const,
	},
] as const;
