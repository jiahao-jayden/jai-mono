import type { CodingSession } from "@jai/coding/business";
import { type MotionValue, motion } from "motion/react";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarNav } from "./sidebar-nav";
import { SidebarRecents } from "./sidebar-recents";

interface SidebarProps {
	sessions: readonly CodingSession[];
	runningSessionIds: readonly string[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	width?: MotionValue<number>;
	settingsDisabled: boolean;
	onToggleSidebar(): void;
	onNewChat(): void;
	onOpenSettings(): void;
	onSelectSession(sessionId: string): void;
	onLoadMore?(): void;
}

export function Sidebar({
	sessions,
	activeSessionId,
	loading,
	error,
	hasNextPage = false,
	loadingMore = false,
	width,
	settingsDisabled,
	onToggleSidebar,
	onNewChat,
	onOpenSettings,
	onSelectSession,
	onLoadMore,
}: SidebarProps) {
	return (
		<motion.aside
			className="flex h-full w-66 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
			style={width ? { width } : undefined}
		>
			<SidebarHeader onToggleSidebar={onToggleSidebar} />
			<SidebarNav onNewChat={onNewChat} />
			<SidebarRecents
				sessions={sessions}
				activeSessionId={activeSessionId}
				loading={loading}
				error={error}
				hasNextPage={hasNextPage}
				loadingMore={loadingMore}
				onSelectSession={onSelectSession}
				onLoadMore={onLoadMore}
			/>
			<SidebarFooter settingsDisabled={settingsDisabled} onOpenSettings={onOpenSettings} />
		</motion.aside>
	);
}
