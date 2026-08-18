import type { CodingSession } from "@jai/coding-agent/business";
import { type MotionValue, motion } from "motion/react";
import type { DesktopProject } from "../../../../shared/desktop-rpc";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarNav } from "./sidebar-nav";
import { SidebarRecents } from "./sidebar-recents";

interface SidebarProps {
	activeView: "chat" | "chats" | "projects" | "project";
	sessions: readonly CodingSession[];
	projects: readonly DesktopProject[];
	runningSessionIds: readonly string[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	width?: MotionValue<number>;
	onToggleSidebar(): void;
	onNewChat(): void;
	onOpenChats(): void;
	onOpenProjects(): void;
	onOpenSettings(): void;
	onSelectSession(sessionId: string): void;
	onRenameSession(sessionId: string, title: string): Promise<void>;
	onMoveSession(sessionId: string, projectId: string | null): Promise<void>;
	onDeleteSession(sessionId: string): Promise<void>;
	onLoadMore?(): void;
}

export function Sidebar({
	activeView,
	sessions,
	projects,
	activeSessionId,
	loading,
	error,
	hasNextPage = false,
	loadingMore = false,
	width,
	onToggleSidebar,
	onNewChat,
	onOpenChats,
	onOpenProjects,
	onOpenSettings,
	onSelectSession,
	onRenameSession,
	onMoveSession,
	onDeleteSession,
	onLoadMore,
}: SidebarProps) {
	return (
		<motion.aside
			className="flex h-full w-66 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
			style={width ? { width } : undefined}
		>
			<SidebarHeader onToggleSidebar={onToggleSidebar} />
			<SidebarNav
				activeView={activeView}
				onNewChat={onNewChat}
				onOpenChats={onOpenChats}
				onOpenProjects={onOpenProjects}
			/>
			<SidebarRecents
				sessions={sessions}
				projects={projects}
				activeSessionId={activeSessionId}
				loading={loading}
				error={error}
				hasNextPage={hasNextPage}
				loadingMore={loadingMore}
				onSelectSession={onSelectSession}
				onRenameSession={onRenameSession}
				onMoveSession={onMoveSession}
				onDeleteSession={onDeleteSession}
				onLoadMore={onLoadMore}
			/>
			<SidebarFooter onOpenSettings={onOpenSettings} />
		</motion.aside>
	);
}
