import type { CSSProperties, ReactNode } from "react";
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
	const SearchIcon = icons.search;
	const PanelLeftCloseIcon = icons["panel-left-close"];

	return (
		<div className="flex h-13 shrink-0 items-center justify-end px-3" style={drag}>
			<div className="flex items-center gap-1" style={noDrag}>
				<Button
					type="button"
					variant="navigation"
					size="icon-sm"
					onClick={onToggleSidebar}
					aria-label={intl.formatMessage(desktopMessages.sidebarCollapse)}
					title={intl.formatMessage(desktopMessages.sidebarCollapse)}
					className="size-7.5 rounded-[7px] text-muted-foreground/60 hover:text-muted-foreground"
				>
					<PanelLeftCloseIcon size={16} className="rotate-180" />
				</Button>
				<IconButton label={intl.formatMessage(desktopMessages.sidebarSearchComingLater)}>
					<SearchIcon size={16} />
				</IconButton>
			</div>
		</div>
	);
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Button
			type="button"
			variant="navigation"
			size="icon-sm"
			aria-disabled="true"
			tabIndex={-1}
			aria-label={label}
			title={label}
			className="size-7.5 cursor-default rounded-[7px] text-muted-foreground/60 hover:text-muted-foreground"
		>
			{children}
		</Button>
	);
}
