import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
	settingsCategories,
	settingsCategoryGroups,
	type SettingsCategory,
} from "../settings/settings-navigation";

const settingsItemClassName =
	"h-7 w-full justify-start gap-2 rounded-lg px-2 text-left text-[12px] font-normal text-sidebar-foreground";

interface SidebarSettingsProps {
	category: SettingsCategory;
	onCategoryChange(category: SettingsCategory): void;
	onBack(): void;
}

export function SidebarSettings({ category, onCategoryChange, onBack }: SidebarSettingsProps) {
	const intl = useIntl();
	const icons = useIcons();
	const SearchIcon = icons.search;
	const ArrowLeftIcon = icons["arrow-left"];
	const [query, setQuery] = useState("");
	const normalizedQuery = query.trim().toLowerCase();
	const groups = useMemo(
		() =>
			settingsCategoryGroups
				.map((group) => ({
					...group,
					categories: group.categories.filter((id) =>
						intl.formatMessage(settingsCategories[id].label).toLowerCase().includes(normalizedQuery),
					),
				}))
				.filter((group) => group.categories.length > 0),
		[normalizedQuery, intl],
	);

	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
			<Button
				type="button"
				variant="navigation"
				size="md"
				leadingIcon={ArrowLeftIcon}
				onClick={onBack}
				className={settingsItemClassName}
			>
				{intl.formatMessage(desktopMessages.settingsBackToApp)}
			</Button>
			<div className="relative mt-3 mb-3 px-1">
				<SearchIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={intl.formatMessage(desktopMessages.settingsSearch)}
					aria-label={intl.formatMessage(desktopMessages.settingsSearch)}
					density="compact"
					className="h-7 rounded-lg border-0 bg-surface-secondary pl-8 text-[12px] shadow-none"
				/>
			</div>
			<nav aria-label={intl.formatMessage(desktopMessages.settingsTitle)} className="flex flex-col">
				{groups.map((group) => (
					<section key={group.label.id} className="not-first:mt-3">
						<h2 className="px-2 py-1 text-[11px] font-normal text-muted-foreground/70">
							{intl.formatMessage(group.label)}
						</h2>
						<div className="flex flex-col gap-0.5">
							{group.categories.map((id) => {
								const item = settingsCategories[id];
								const Icon = icons[item.icon];
								const isActive = category === id;
								return (
									<Button
										type="button"
										variant="navigation"
										size="md"
										leadingIcon={Icon}
										key={id}
										onClick={() => onCategoryChange(id)}
										aria-current={isActive ? "page" : undefined}
										active={isActive}
										className={settingsItemClassName}
									>
										{intl.formatMessage(item.label)}
									</Button>
								);
							})}
						</div>
					</section>
				))}
			</nav>
		</div>
	);
}
