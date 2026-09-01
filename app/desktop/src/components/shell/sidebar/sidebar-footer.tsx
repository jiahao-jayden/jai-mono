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
	const SettingsIcon = icons.settings;

	return (
		<div className="shrink-0 border-t border-sidebar-border px-2.5 py-2">
			<Button
				type="button"
				variant="navigation"
				size="md"
				leadingIcon={SettingsIcon}
				onClick={onOpenSettings}
				title={intl.formatMessage(desktopMessages.sidebarSettingsShortcut)}
				className="w-full justify-start gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] text-foreground/85"
			>
				{intl.formatMessage(desktopMessages.sidebarSettings)}
			</Button>
		</div>
	);
}
