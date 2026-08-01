import type { CSSProperties, ReactNode } from "react";
import { desktopPlatform } from "@/lib/desktop";
import { WindowControls } from "./window-controls";

const drag = { WebkitAppRegion: "drag" } as CSSProperties;

export function Titlebar({ children }: { children?: ReactNode }) {
	return (
		<header
			className="flex h-11 shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4"
			style={drag}
		>
			{desktopPlatform.isMac ? <WindowControls /> : null}
			{children}
		</header>
	);
}
