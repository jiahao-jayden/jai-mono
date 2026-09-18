import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";

export const sidebarItemClassName =
	"h-[30px] w-full justify-start gap-2 rounded-lg px-2 text-left text-[13px] font-normal text-sidebar-foreground";

interface SidebarNavProps {
	onNewChat(): void;
}

export function SidebarNav({ onNewChat }: SidebarNavProps) {
	const intl = useIntl();
	const icons = useIcons();

	return (
		<nav aria-label={intl.formatMessage(desktopMessages.sidebarPrimary)} className="space-y-0.5 px-1.5 pt-1.5">
			<Button
				type="button"
				variant="navigation"
				size="md"
				onClick={onNewChat}
				leadingIcon={icons.pencil}
				className={sidebarItemClassName}
			>
				{intl.formatMessage(desktopMessages.sidebarNew)}
			</Button>
		</nav>
	);
}
