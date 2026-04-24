import { cn } from "@/lib/utils";
import { WindowControls } from "./window-controls";

const isMac = window.desktop?.isMac ?? false;
const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function Titlebar({ children, className }: { children?: React.ReactNode; className?: string }) {
	return (
		<div className={cn("flex h-12 items-center gap-0.5 px-3", className)} style={drag}>
			{isMac && (
				<div className="mr-2 ml-1">
					<WindowControls />
				</div>
			)}
			{children}
		</div>
	);
}

export function ToolbarButton({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			className={cn(
				"inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground",
				className,
			)}
			style={noDrag}
			{...props}
		>
			{children}
		</button>
	);
}
