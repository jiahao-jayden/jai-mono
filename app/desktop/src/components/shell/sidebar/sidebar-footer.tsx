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

	return (
		<div className="flex h-11 shrink-0 items-center px-1">
			<Button
				type="button"
				variant="navigation"
				size="sm"
				leadingIcon={icons.settings}
				onClick={onOpenSettings}
				title={intl.formatMessage(desktopMessages.sidebarSettingsShortcut)}
				className="h-7 w-full justify-start gap-1.5 rounded-lg px-1.5 text-[13px] font-normal text-sidebar-muted"
			>
				{intl.formatMessage(desktopMessages.sidebarSettings)}
			</Button>
		</div>
	);
}
