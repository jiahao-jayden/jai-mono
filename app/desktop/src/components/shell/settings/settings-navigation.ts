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
	| "advanced";

export const settingsCategories: Record<SettingsCategory, { label: MessageDescriptor; icon: IconName }> = {
	general: { label: desktopMessages.settingsGeneral, icon: "settings" },
	profile: { label: desktopMessages.settingsProfile, icon: "analytics" },
	archived: { label: desktopMessages.settingsArchivedChats, icon: "archive" },
	providers: { label: desktopMessages.settingsProviders, icon: "key" },
	"web-search": { label: desktopMessages.settingsWebSearch, icon: "globe" },
	connector: { label: desktopMessages.settingsConnector, icon: "link" },
	mcp: { label: desktopMessages.settingsMcp, icon: "plug" },
	advanced: { label: desktopMessages.settingsAdvanced, icon: "layers" },
};

export const settingsCategoryGroups = [
	{
		label: desktopMessages.settingsTitle,
		categories: ["general", "profile", "archived"] as const,
	},
	{
		label: desktopMessages.settingsIntegrations,
		categories: ["providers", "web-search", "connector", "mcp", "advanced"] as const,
	},
] as const;
