import { cn } from "cn";
import type { CSSProperties } from "react";
import { DESKTOP_TOP_BAR_HEIGHT_CLASS, MAC_SIDEBAR_LEADING_PADDING_CLASS } from "../desktop-chrome";
import { SidebarToggleButton } from "./sidebar-toggle-button";

const drag = { WebkitAppRegion: "drag" } as CSSProperties;

interface SidebarHeaderProps {
	macTitleBar?: boolean;
	onToggleSidebar(): void;
}

export function SidebarHeader({ macTitleBar = false, onToggleSidebar }: SidebarHeaderProps) {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center",
				DESKTOP_TOP_BAR_HEIGHT_CLASS,
				macTitleBar ? MAC_SIDEBAR_LEADING_PADDING_CLASS : "justify-end px-1.5",
			)}
			style={drag}
		>
			<SidebarToggleButton expanded onToggle={onToggleSidebar} />
		</div>
	);
}
