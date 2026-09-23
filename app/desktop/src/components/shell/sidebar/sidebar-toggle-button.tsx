import { cn } from "cn";
import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

interface SidebarToggleButtonProps {
	expanded: boolean;
	onToggle(): void;
}

export function SidebarToggleButton({ expanded, onToggle }: SidebarToggleButtonProps) {
	const intl = useIntl();
	const icons = useIcons();
	const PanelLeftIcon = icons["panel-left-close"];
	const label = intl.formatMessage(expanded ? desktopMessages.sidebarCollapse : desktopMessages.chatShowSidebar);

	return (
		<Button
			type="button"
			variant="navigation"
			size="icon-sm"
			onClick={onToggle}
			aria-label={label}
			title={label}
			className="rounded-lg"
			style={noDrag}
		>
			<PanelLeftIcon size={16} className={cn({ "rotate-180": expanded })} />
		</Button>
	);
}
