import { type MotionValue, motion } from "motion/react";
import { useState } from "react";
import logo from "@/assets/icons/chat-area/logo.svg";
import "@fontsource/outfit/latin-600.css";
import type { CodingSession, DesktopProject } from "../../../../shared/desktop-rpc";
import { CreateProjectDialog } from "../create-project-dialog";
import type { SettingsCategory } from "../settings/settings-navigation";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarNav } from "./sidebar-nav";
import { SidebarSessions } from "./sidebar-sessions";
import { SidebarSettings } from "./sidebar-settings";

interface SidebarProps {
	macTitleBar?: boolean;
	projects: readonly DesktopProject[];
	sessions: readonly CodingSession[];
	runningSessionIds: readonly string[];
	activeSessionId: string | null;
	activeProjectId: string | null;
	loading: boolean;
	error?: string;
	onRetryRecents(): void;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	projectLoading: boolean;
	projectLoadError: boolean;
	onRetryProjects(): void;
	width?: MotionValue<number>;
	onToggleSidebar(): void;
	onNewChat(): void;
	onOpenSettings(): void;
	onRelinkProject(project: DesktopProject): Promise<void>;
	onRevealProject(project: DesktopProject): Promise<void>;
	onNewProjectChat(project: DesktopProject): void;
	onSelectSession(sessionId: string): void;
	onRenameSession(sessionId: string, title: string): Promise<void>;
	onPinSession(sessionId: string, pinned: boolean): Promise<void>;
	onArchiveSession(sessionId: string): Promise<void>;
	onDeleteSession(sessionId: string): Promise<void>;
	onLoadMore?(): void;
	settingsMode?: boolean;
	settingsCategory?: SettingsCategory;
	onSettingsCategoryChange?(category: SettingsCategory): void;
	onBackFromSettings?(): void;
}

export function Sidebar({
	macTitleBar = false,
	projects,
	sessions,
	runningSessionIds,
	activeSessionId,
	activeProjectId,
	loading,
	error,
	onRetryRecents,
	hasNextPage = false,
	loadingMore = false,
	projectLoading,
	projectLoadError,
	onRetryProjects,
	width,
	onToggleSidebar,
	onNewChat,
	onOpenSettings,
	onRelinkProject,
	onRevealProject,
	onNewProjectChat,
	onSelectSession,
	onRenameSession,
	onPinSession,
	onArchiveSession,
	onDeleteSession,
	onLoadMore,
	settingsMode = false,
	settingsCategory = "general",
	onSettingsCategoryChange,
	onBackFromSettings,
}: SidebarProps) {
	const [creatingProject, setCreatingProject] = useState(false);

	return (
		<motion.aside
			className="flex h-full w-60 shrink-0 flex-col overflow-hidden px-1.5 text-sidebar-foreground"
			style={width ? { width } : undefined}
		>
			<SidebarHeader macTitleBar={macTitleBar} onToggleSidebar={onToggleSidebar} />
			{!settingsMode ? (
				<div className="flex h-10 shrink-0 items-center gap-2 px-3.5">
					<img src={logo} alt="" draggable={false} className="size-7 shrink-0 select-none" />
					<span className="truncate [font-family:Outfit,var(--font-sans)] text-[18px] font-[600] tracking-[-0.02em] text-foreground">
						PandaWork
					</span>
				</div>
			) : null}
			{settingsMode ? (
				<SidebarSettings
					category={settingsCategory}
					onCategoryChange={onSettingsCategoryChange ?? (() => undefined)}
					onBack={onBackFromSettings ?? onNewChat}
				/>
			) : (
				<>
					<SidebarNav onNewChat={onNewChat} />
					<SidebarSessions
						projects={projects}
						sessions={sessions}
						runningSessionIds={runningSessionIds}
						activeSessionId={activeSessionId}
						activeProjectId={activeProjectId}
						loading={loading}
						error={error}
						onRetryRecents={onRetryRecents}
						hasNextPage={hasNextPage}
						loadingMore={loadingMore}
						projectLoading={projectLoading}
						projectLoadError={projectLoadError}
						onRetryProjects={onRetryProjects}
						onCreateProject={() => setCreatingProject(true)}
						onRelinkProject={onRelinkProject}
						onRevealProject={onRevealProject}
						onNewProjectChat={onNewProjectChat}
						onSelectSession={onSelectSession}
						onRenameSession={onRenameSession}
						onPinSession={onPinSession}
						onArchiveSession={onArchiveSession}
						onDeleteSession={onDeleteSession}
						onLoadMore={onLoadMore}
					/>
					<SidebarFooter onOpenSettings={onOpenSettings} />
					<CreateProjectDialog open={creatingProject} onOpenChange={setCreatingProject} />
				</>
			)}
		</motion.aside>
	);
}
