import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";

interface SidebarFooterProps {
	onOpenSettings(): void;
}

export function SidebarFooter({ onOpenSettings }: SidebarFooterProps) {
	const intl = useIntl();
	const icons = useIcons();
	const SearchIcon = icons.search;
	const searchLabel = intl.formatMessage(desktopMessages.sidebarSearchComingLater);

	return (
		<div className="flex h-11 shrink-0 items-center justify-between pr-1.5 pl-1">
			<Button
				type="button"
				variant="navigation"
				size="sm"
				leadingIcon={icons.settings}
				onClick={onOpenSettings}
				title={intl.formatMessage(desktopMessages.sidebarSettingsShortcut)}
				className="h-7 gap-1.5 rounded-md px-1.5 text-[13px] font-normal text-sidebar-muted"
			>
				{intl.formatMessage(desktopMessages.sidebarSettings)}
			</Button>
			<Button
				type="button"
				variant="navigation"
				size="icon-sm"
				aria-disabled="true"
				tabIndex={-1}
				aria-label={searchLabel}
				title={searchLabel}
				className="cursor-default rounded-md"
			>
				<SearchIcon size={16} />
			</Button>
		</div>
	);
}
