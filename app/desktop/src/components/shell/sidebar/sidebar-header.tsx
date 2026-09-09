import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";

const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

interface SidebarHeaderProps {
	onToggleSidebar(): void;
}

export function SidebarHeader({ onToggleSidebar }: SidebarHeaderProps) {
	const intl = useIntl();
	const icons = useIcons();
	const PanelLeftCloseIcon = icons["panel-left-close"];

	return (
		<div className="flex h-11 shrink-0 items-center justify-end pr-1.5" style={drag}>
			<Button
				type="button"
				variant="navigation"
				size="icon-sm"
				onClick={onToggleSidebar}
				aria-label={intl.formatMessage(desktopMessages.sidebarCollapse)}
				title={intl.formatMessage(desktopMessages.sidebarCollapse)}
				className="rounded-md"
				style={noDrag}
			>
				<PanelLeftCloseIcon size={16} className="rotate-180" />
			</Button>
		</div>
	);
}
