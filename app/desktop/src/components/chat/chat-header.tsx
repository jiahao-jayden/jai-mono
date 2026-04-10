import { Bell, PanelLeftIcon, PenLine, Search, Settings } from "lucide-react";
import { Titlebar, ToolbarButton } from "@/components/shell/titlebar";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/session";
import type { ChatStatus } from "@/types/chat";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

function StatusBadge({ status }: { status: ChatStatus }) {
	const isActive = status === "streaming" || status === "submitted";
	const isError = status === "error";
	return (
		<div
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
				isError
					? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
					: isActive
						? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
						: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
			)}
		>
			<span
				className={cn(
					"h-1.5 w-1.5 rounded-full",
					isError ? "bg-red-500" : isActive ? "bg-emerald-500 animate-pulse" : "bg-zinc-400",
				)}
			/>
			{isError ? "Error" : isActive ? "Agent Active" : "Ready"}
		</div>
	);
}

interface ChatHeaderProps {
	status: ChatStatus;
}

export function ChatHeader({ status }: ChatHeaderProps) {
	const { open, toggleSidebar } = useSidebar();
	const title = useSessionStore((s) => s.title);

	return (
		<>
			{/* Desktop drag region + titlebar buttons */}
			<div className={cn("w-full shrink-0 hidden md:flex items-center", open ? "h-3" : "h-12")}>
				{!open && (
					<Titlebar>
						<ToolbarButton onClick={toggleSidebar}>
							<PanelLeftIcon className="h-4 w-4" />
						</ToolbarButton>
						<ToolbarButton>
							<Search className="h-4 w-4" />
						</ToolbarButton>
						<ToolbarButton>
							<PenLine className="h-4 w-4" />
						</ToolbarButton>
					</Titlebar>
				)}
				<div className="h-full flex-1" style={drag} />
			</div>

			{/* Session info header */}
			<div className="px-5 flex items-center justify-between shrink-0">
				<div className="flex flex-col gap-0.5">
					{title && (
						<h1 className="text-sm font-semibold text-foreground tracking-tight leading-none font-serif">
							{title}
						</h1>
					)}
				</div>

				<div className="flex items-center gap-2">
					<StatusBadge status={status} />
					<ToolbarButton>
						<Bell className="h-4 w-4" />
					</ToolbarButton>
					<ToolbarButton>
						<Settings className="h-4 w-4" />
					</ToolbarButton>
				</div>
			</div>

			{/* Mobile header */}
			<header
				className="h-14 flex items-center justify-between px-4 md:hidden bg-card/80 backdrop-blur-md sticky top-0 z-10 border-b"
				style={drag}
			>
				<ToolbarButton onClick={toggleSidebar}>
					<PanelLeftIcon className="w-5 h-5" />
				</ToolbarButton>
				<div className="font-serif font-medium text-lg">noa.</div>
				<ToolbarButton>
					<PenLine className="w-5 h-5" />
				</ToolbarButton>
			</header>
		</>
	);
}
