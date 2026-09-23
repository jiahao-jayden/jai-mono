import { cn } from "cn";
import { useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import type { CodingSession, DesktopProject } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { toast } from "../../ui/toast";
import { ProjectActions } from "../project-actions";
import { SessionActions } from "../session-actions";
import { sidebarItemClassName } from "./sidebar-nav";
import { sidebarRowHoverReserveClassName, sidebarRowSpinnerReserveClassName } from "./sidebar-row-hover";

interface SidebarSessionsProps {
	readonly projects: readonly DesktopProject[];
	readonly sessions: readonly CodingSession[];
	readonly runningSessionIds: readonly string[];
	readonly activeSessionId: string | null;
	readonly loading: boolean;
	readonly error?: string;
	readonly hasNextPage?: boolean;
	readonly loadingMore?: boolean;
	readonly projectLoading: boolean;
	readonly projectError?: string;
	readonly onCreateProject: () => void;
	readonly onRelinkProject: (project: DesktopProject) => Promise<void>;
	readonly onRevealProject: (project: DesktopProject) => Promise<void>;
	readonly onNewProjectChat: (project: DesktopProject) => void;
	readonly onSelectSession: (sessionId: string) => void;
	readonly onRenameSession: (sessionId: string, title: string) => Promise<void>;
	readonly onPinSession: (sessionId: string, pinned: boolean) => Promise<void>;
	readonly onArchiveSession: (sessionId: string) => Promise<void>;
	readonly onDeleteSession: (sessionId: string) => Promise<void>;
	onLoadMore?(): void;
}

export function SidebarSessions({
	projects,
	sessions,
	runningSessionIds,
	activeSessionId,
	loading,
	error,
	hasNextPage = false,
	loadingMore = false,
	projectLoading,
	projectError,
	onCreateProject,
	onRelinkProject,
	onRevealProject,
	onNewProjectChat,
	onSelectSession,
	onRenameSession,
	onPinSession,
	onArchiveSession,
	onDeleteSession,
	onLoadMore,
}: SidebarSessionsProps) {
	const intl = useIntl();
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(() => new Set());
	const [chatsExpanded, setChatsExpanded] = useState(true);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const cancelEditRef = useRef(false);
	const activeSessions = useMemo(() => sessions.filter((session) => session.archivedAt === null), [sessions]);
	const sessionsByProject = useMemo(() => {
		const grouped = new Map<string, CodingSession[]>();
		for (const session of activeSessions) {
			if (!session.projectId) continue;
			const current = grouped.get(session.projectId) ?? [];
			grouped.set(session.projectId, [...current, session]);
		}
		return grouped;
	}, [activeSessions]);
	const sortedProjects = useMemo(
		() =>
			projects.toSorted((left, right) => {
				const leftActivity = sessionsByProject.get(left.id)?.[0]?.lastActivityAt ?? left.updatedAt;
				const rightActivity = sessionsByProject.get(right.id)?.[0]?.lastActivityAt ?? right.updatedAt;
				return rightActivity - leftActivity || left.displayName.localeCompare(right.displayName);
			}),
		[projects, sessionsByProject],
	);
	const ungroupedSessions = activeSessions.filter((session) => session.projectId === null);
	const runningSessionIdSet = useMemo(() => new Set(runningSessionIds), [runningSessionIds]);

	const startEditing = (session: CodingSession) => {
		cancelEditRef.current = false;
		setEditingTitle(session.title);
		setEditingSessionId(session.id);
	};
	const cancelEditing = () => {
		cancelEditRef.current = true;
		setEditingSessionId(null);
	};
	const saveEditing = async (session: CodingSession) => {
		if (cancelEditRef.current) {
			cancelEditRef.current = false;
			return;
		}
		setEditingSessionId(null);
		const title = editingTitle.trim();
		if (!title || title === session.title) return;
		try {
			await onRenameSession(session.id, title);
		} catch {
			toast.add({
				title: intl.formatMessage(desktopMessages.sidebarRenameFailed),
				description: intl.formatMessage(desktopMessages.sidebarRenameFailed),
				type: "error",
			});
		}
	};
	const startProjectChat = (project: DesktopProject) => {
		setExpandedProjectIds((current) => new Set(current).add(project.id));
		onNewProjectChat(project);
	};
	const toggleProject = (projectId: string) => {
		setExpandedProjectIds((current) => {
			const next = new Set(current);
			if (next.has(projectId)) next.delete(projectId);
			else next.add(projectId);
			return next;
		});
	};
	const renderSession = (session: CodingSession, nested = false) => {
		const selected = session.id === activeSessionId;
		const editing = session.id === editingSessionId;
		const running = runningSessionIdSet.has(session.id);
		const rowClassName = cn(sidebarItemClassName, "group-hover/row:text-sidebar-foreground", {
			[sidebarRowHoverReserveClassName]: !running,
			[sidebarRowSpinnerReserveClassName]: running,
			"pl-8": nested,
		});
		if (editing) {
			return (
				<Input
					key={session.id}
					autoFocus
					density="compact"
					value={editingTitle}
					onChange={(event) => setEditingTitle(event.target.value)}
					onBlur={() => void saveEditing(session)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.blur();
						} else if (event.key === "Escape") {
							event.preventDefault();
							cancelEditing();
						}
					}}
					aria-label={intl.formatMessage(desktopMessages.sessionTitle)}
					maxLength={80}
					className={cn(
						"h-7.5 rounded-lg border-transparent bg-sidebar-active py-0 text-[13px] leading-4.5 font-normal focus-visible:border-border-surface-strong focus-visible:shadow-none! focus-visible:ring-0",
						nested ? "px-1.75 pl-8" : "px-1.75",
					)}
				/>
			);
		}
		return (
			<SessionActions
				key={session.id}
				session={session}
				running={running}
				hoverActions
				onStartRename={() => startEditing(session)}
				onPin={onPinSession}
				onArchive={onArchiveSession}
				onDelete={onDeleteSession}
			>
				<Button
					type="button"
					variant="navigation"
					size="md"
					onClick={() => onSelectSession(session.id)}
					onDoubleClick={() => selected && startEditing(session)}
					onKeyDown={(event) => {
						if (selected && event.key === "F2") {
							event.preventDefault();
							startEditing(session);
						}
					}}
					aria-current={selected ? "page" : undefined}
					active={selected}
					contentClassName="w-full min-w-0"
					labelClassName="min-w-0 flex-1 leading-4.5 [text-box:normal]"
					className={rowClassName}
				>
					<span className="block truncate">{session.title}</span>
				</Button>
			</SessionActions>
		);
	};

	return (
		<div className="scrollbar-hidden mt-3.5 min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
			<section aria-labelledby="sidebar-projects-heading">
				<div className="flex h-6 items-center justify-between px-2">
					<span
						id="sidebar-projects-heading"
						className="text-[12px] font-medium tracking-[-0.005em] text-sidebar-muted"
					>
						{intl.formatMessage(desktopMessages.sidebarProjects)}
					</span>
					<Button
						type="button"
						variant="navigation"
						size="icon-xs"
						onClick={onCreateProject}
						aria-label={intl.formatMessage(desktopMessages.projectsNew)}
						title={intl.formatMessage(desktopMessages.projectsNew)}
					>
						<PlusIcon size={14} strokeWidth={1.5} />
					</Button>
				</div>
				<div className="mt-1 space-y-0.5">
					{projectLoading && projects.length === 0 ? (
						<div
							className="space-y-0.5"
							role="status"
							aria-label={intl.formatMessage(desktopMessages.projectsLoading)}
						>
							{[0, 1].map((item) => (
								<div key={item} className="h-7.5 animate-pulse rounded-lg bg-foreground/5" />
							))}
						</div>
					) : null}
					{projectError ? (
						<p
							className="rounded-lg bg-destructive/8 px-2 py-2 text-[12px] leading-relaxed text-destructive"
							role="alert"
						>
							{projectError}
						</p>
					) : null}
					{!projectLoading && !projectError && sortedProjects.length === 0 ? (
						<p className="px-2 py-1.5 text-[13px] leading-4.5 text-sidebar-muted">
							{intl.formatMessage(desktopMessages.sidebarNoProjects)}
						</p>
					) : null}
					{sortedProjects.map((project) => {
						const expanded = expandedProjectIds.has(project.id);
						const projectSessions = sessionsByProject.get(project.id) ?? [];
						const hasHiddenActiveSession =
							!expanded && projectSessions.some((session) => session.id === activeSessionId);
						const projectIcon = project.available
							? expanded
								? icons["folder-open"]
								: icons.folder
							: icons["folder-off"];
						const projectLabel = intl.formatMessage(
							project.available ? desktopMessages.projectsAvailable : desktopMessages.projectsFolderUnavailable,
						);
						return (
							<div key={project.id}>
								<ProjectActions
									project={project}
									onRelink={onRelinkProject}
									onReveal={onRevealProject}
									onNewChat={startProjectChat}
								>
									<Button
										type="button"
										variant="navigation"
										size="md"
										onClick={() => toggleProject(project.id)}
										aria-expanded={expanded}
										aria-current={hasHiddenActiveSession ? "page" : undefined}
										active={hasHiddenActiveSession}
										leadingIcon={projectIcon}
										className={cn(
											sidebarItemClassName,
											sidebarRowHoverReserveClassName,
											"group-hover/row:text-sidebar-foreground",
										)}
									>
										<span className="flex min-w-0 items-center gap-1.5">
											<span className="truncate">{project.displayName}</span>
											<span className="sr-only">{projectLabel}</span>
										</span>
									</Button>
								</ProjectActions>
								{expanded ? (
									<div className="mt-0.5 space-y-0.5">
										{projectSessions.map((session) => renderSession(session, true))}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</section>
			<section className="mt-4" aria-labelledby="sidebar-chats-heading">
				<div className="flex h-6 items-center">
					<Button
						id="sidebar-chats-heading"
						type="button"
						variant="navigation"
						size="sm"
						onClick={() => setChatsExpanded((expanded) => !expanded)}
						aria-expanded={chatsExpanded}
						aria-controls="sidebar-chats-list"
						trailingIcon={chatsExpanded ? icons["chevron-down"] : icons["chevron-right"]}
						className="h-6 w-full justify-between px-2 text-[12px] font-medium tracking-[-0.005em] text-sidebar-muted [&>span:first-child]:bg-transparent!"
					>
						{intl.formatMessage(desktopMessages.sidebarChats)}
					</Button>
				</div>
				{chatsExpanded ? (
					<div id="sidebar-chats-list" className="mt-1 space-y-0.5">
						{loading && activeSessions.length === 0 ? (
							<div
								className="space-y-0.5"
								role="status"
								aria-label={intl.formatMessage(desktopMessages.sidebarLoadingRecentSessions)}
							>
								{[0, 1, 2].map((item) => (
									<div key={item} className="h-7.5 animate-pulse rounded-lg bg-foreground/5" />
								))}
							</div>
						) : null}
						{error ? (
							<p
								className="rounded-lg bg-destructive/8 px-2 py-2 text-[12px] leading-relaxed text-destructive"
								role="alert"
							>
								{intl.formatMessage(desktopMessages.sidebarRecentsLoadError)}
							</p>
						) : null}
						{!loading && !error && ungroupedSessions.length === 0 ? (
							<p className="px-2 py-1.5 text-[13px] leading-4.5 text-sidebar-muted">
								{intl.formatMessage(desktopMessages.sidebarNoChats)}
							</p>
						) : null}
						{ungroupedSessions.map((session) => renderSession(session))}
						{hasNextPage ? (
							<Button
								type="button"
								variant="navigation"
								size="sm"
								disabled={loadingMore}
								onClick={onLoadMore}
								className={cn(sidebarItemClassName, "text-sidebar-muted")}
							>
								{intl.formatMessage(
									loadingMore ? desktopMessages.sidebarLoadingMore : desktopMessages.sidebarLoadMore,
								)}
							</Button>
						) : null}
					</div>
				) : null}
			</section>
		</div>
	);
}
