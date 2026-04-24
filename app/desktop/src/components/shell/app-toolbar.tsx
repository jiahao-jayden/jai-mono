import { Search01Icon, SidebarLeftIcon, SidebarRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { PanelLeftIcon, PenLine } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Titlebar, ToolbarButton } from "./titlebar";
import { WindowControls } from "./window-controls";

const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
const isMacDesktop = window.desktop?.isMac ?? false;

interface BaseToolbarProps {
	className?: string;
	onToggleSidebar: () => void;
	onNewChat: () => void;
}

interface DesktopToolbarProps extends BaseToolbarProps {
	mode: "desktop";
	sidebarIcon: "left" | "right";
}

interface MobileToolbarProps extends BaseToolbarProps {
	mode: "mobile";
	title: ReactNode;
}

type AppToolbarProps = DesktopToolbarProps | MobileToolbarProps;

function DesktopSidebarToggle({
	sidebarIcon,
	onToggleSidebar,
}: Pick<DesktopToolbarProps, "sidebarIcon" | "onToggleSidebar">) {
	const icon = sidebarIcon === "left" ? SidebarLeftIcon : SidebarRightIcon;

	return (
		<ToolbarButton onClick={onToggleSidebar}>
			<HugeiconsIcon icon={icon} size={16} />
		</ToolbarButton>
	);
}

export function AppToolbar(props: AppToolbarProps) {
	if (props.mode === "mobile") {
		return (
			<header
				className={cn(
					"h-14 flex items-center gap-3 px-4 md:hidden",
					"bg-card/80 backdrop-blur-md sticky top-0 z-10 border-b",
				)}
				style={drag}
			>
				<div className="flex items-center gap-3" style={noDrag}>
					{isMacDesktop && <WindowControls />}
					<ToolbarButton onClick={props.onToggleSidebar}>
						<PanelLeftIcon className="w-5 h-5" />
					</ToolbarButton>
				</div>
				<div className="min-w-0 flex-1 px-3 text-center" style={noDrag}>
					<div className="truncate font-serif text-lg font-medium leading-none">{props.title}</div>
				</div>
				<ToolbarButton onClick={props.onNewChat}>
					<PenLine className="w-5 h-5" />
				</ToolbarButton>
			</header>
		);
	}

	return (
		<Titlebar className={props.className}>
			<DesktopSidebarToggle sidebarIcon={props.sidebarIcon} onToggleSidebar={props.onToggleSidebar} />
			<ToolbarButton className="hover:cursor-pointer">
				<HugeiconsIcon icon={Search01Icon} size={16} />
			</ToolbarButton>
		</Titlebar>
	);
}
