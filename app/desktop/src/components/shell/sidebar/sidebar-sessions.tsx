import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
	draggable,
	dropTargetForElements,
	monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
import { reorderWithEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge";
import { useInfiniteQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { type ReactNode, type UIEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import {
	getRecentSessions,
	projectSessionsQueryOptions,
	reorderProjects,
	setProjectExpanded,
} from "@/lib/desktop-query";
import { useIcons } from "@/lib/icon-context";
import type { CodingSession, DesktopProject } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { toast } from "../../ui/toast";
import { ProjectActions } from "../project-actions";
import { SessionActions } from "../session-actions";
import { sidebarItemClassName } from "./sidebar-nav";
import { sidebarRowHoverReserveClassName, sidebarRowSpinnerReserveClassName } from "./sidebar-row-hover";

const projectDragKey = Symbol("sidebar-project");

type ProjectDragData = {
	readonly [projectDragKey]: true;
	readonly index: number;
};

function isProjectDragData(
	data: Record<string | symbol, unknown>,
): data is Record<string | symbol, unknown> & ProjectDragData {
	return data[projectDragKey] === true && typeof data.index === "number";
}

interface SidebarSessionsProps {
	readonly projects: readonly DesktopProject[];
	readonly sessions: readonly CodingSession[];
	readonly runningSessionIds: readonly string[];
	readonly activeSessionId: string | null;
	readonly activeProjectId: string | null;
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
	activeProjectId,
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
	const [chatsExpanded, setChatsExpanded] = useState(true);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const cancelEditRef = useRef(false);
	const ungroupedSessions = sessions.filter((session) => session.archivedAt === null && session.projectId === null);
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
	useEffect(
		() =>
			monitorForElements({
				canMonitor: ({ source }) => isProjectDragData(source.data),
				onDrop: ({ source, location }) => {
					const target = location.current.dropTargets[0];
					if (!target || !isProjectDragData(source.data) || !isProjectDragData(target.data)) return;
					const reorder = {
						startIndex: source.data.index,
						indexOfTarget: target.data.index,
						closestEdgeOfTarget: extractClosestEdge(target.data),
						axis: "vertical" as const,
					};
					if (getReorderDestinationIndex(reorder) === reorder.startIndex) return;
					void reorderProjects(reorderWithEdge({ ...reorder, list: projects.map((project) => project.id) }));
				},
			}),
		[projects],
	);

	const startProjectChat = (project: DesktopProject) => {
		if (!project.expanded) void setProjectExpanded(project.id, true);
		onNewProjectChat(project);
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
					{!projectLoading && !projectError && projects.length === 0 ? (
						<p className="px-2 py-1.5 text-[13px] leading-4.5 text-sidebar-muted">
							{intl.formatMessage(desktopMessages.sidebarNoProjects)}
						</p>
					) : null}
				</div>
				<ul aria-labelledby="sidebar-projects-heading" className="space-y-0.5">
					{projects.map((project, index) => (
						<ProjectRow
							key={project.id}
							project={project}
							index={index}
							active={project.id === activeProjectId}
							onToggle={() => void setProjectExpanded(project.id, !project.expanded)}
							onRelink={onRelinkProject}
							onReveal={onRevealProject}
							onNewChat={startProjectChat}
							renderSession={(session) => renderSession(session, true)}
						/>
					))}
				</ul>
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
						{loading && ungroupedSessions.length === 0 ? (
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

function ProjectRow({
	project,
	index,
	active,
	onToggle,
	onRelink,
	onReveal,
	onNewChat,
	renderSession,
}: {
	readonly project: DesktopProject;
	readonly index: number;
	readonly active: boolean;
	readonly onToggle: () => void;
	readonly onRelink: (project: DesktopProject) => Promise<void>;
	readonly onReveal: (project: DesktopProject) => Promise<void>;
	readonly onNewChat: (project: DesktopProject) => void;
	readonly renderSession: (session: CodingSession) => ReactNode;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const expanded = project.expanded;
	const hasHiddenActiveSession = !expanded && active;
	const projectIcon = project.available ? (expanded ? icons["folder-open"] : icons.folder) : icons["folder-off"];
	const projectLabel = intl.formatMessage(
		project.available ? desktopMessages.projectsAvailable : desktopMessages.projectsFolderUnavailable,
	);
	const ProjectIcon = projectIcon;
	const rowRef = useRef<HTMLLIElement>(null);
	const handleRef = useRef<HTMLButtonElement>(null);
	const [dragging, setDragging] = useState(false);
	const [dropEdge, setDropEdge] = useState<Edge | null>(null);
	const [previewContainer, setPreviewContainer] = useState<HTMLElement | null>(null);

	useEffect(() => {
		const row = rowRef.current;
		const handle = handleRef.current;
		if (!row || !handle) return;
		const data: ProjectDragData = { [projectDragKey]: true, index };
		return combine(
			draggable({
				element: handle,
				getInitialData: () => data,
				onGenerateDragPreview: ({ nativeSetDragImage }) =>
					setCustomNativeDragPreview({
						nativeSetDragImage,
						getOffset: pointerOutsideOfPreview({ x: "12px", y: "4px" }),
						render: ({ container }) => {
							setPreviewContainer(container);
							return () => setPreviewContainer(null);
						},
					}),
				onDragStart: () => setDragging(true),
				onDrop: () => setDragging(false),
			}),
			dropTargetForElements({
				element: row,
				canDrop: ({ source }) => isProjectDragData(source.data),
				getData: ({ input, element }) =>
					attachClosestEdge(data, { input, element, allowedEdges: ["top", "bottom"] }),
				onDrag: ({ self, source }) => {
					if (!isProjectDragData(source.data)) return;
					const edge = extractClosestEdge(self.data);
					const destination = getReorderDestinationIndex({
						startIndex: source.data.index,
						indexOfTarget: index,
						closestEdgeOfTarget: edge,
						axis: "vertical",
					});
					setDropEdge(destination === source.data.index ? null : edge);
				},
				onDragLeave: () => setDropEdge(null),
				onDrop: () => setDropEdge(null),
			}),
		);
	}, [index]);

	return (
		<li ref={rowRef} className="relative">
			{dropEdge ? (
				<div
					aria-hidden="true"
					className={cn("pointer-events-none absolute inset-x-1 z-10 flex h-2 items-center", {
						"-top-1.25": dropEdge === "top",
						"-bottom-1.25": dropEdge === "bottom",
					})}
				>
					<span className="size-2 shrink-0 rounded-full border-[1.5px] border-primary" />
					<span className="h-0.5 flex-1 rounded-full bg-primary" />
				</div>
			) : null}
			{previewContainer
				? createPortal(
						<div className="flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-[13px] leading-4.5 text-popover-foreground">
							<ProjectIcon size={14} strokeWidth={1.5} />
							<span className="max-w-48 truncate">{project.displayName}</span>
						</div>,
						previewContainer,
					)
				: null}
			<ProjectActions project={project} onRelink={onRelink} onReveal={onReveal} onNewChat={onNewChat}>
				<Button
					ref={handleRef}
					type="button"
					variant="navigation"
					size="md"
					onClick={onToggle}
					aria-expanded={expanded}
					aria-current={hasHiddenActiveSession ? "page" : undefined}
					active={hasHiddenActiveSession}
					leadingIcon={projectIcon}
					className={cn(
						sidebarItemClassName,
						sidebarRowHoverReserveClassName,
						"group-hover/row:text-sidebar-foreground",
						{ "opacity-40": dragging },
					)}
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate">{project.displayName}</span>
						<span className="sr-only">{projectLabel}</span>
					</span>
				</Button>
			</ProjectActions>
			{expanded ? <ProjectSessionList projectId={project.id} renderSession={renderSession} /> : null}
		</li>
	);
}

function ProjectSessionList({
	projectId,
	renderSession,
}: {
	readonly projectId: string;
	readonly renderSession: (session: CodingSession) => ReactNode;
}) {
	const query = useInfiniteQuery(projectSessionsQueryOptions(projectId));
	const sessions = getRecentSessions(query.data);
	const onScroll = (event: UIEvent<HTMLDivElement>) => {
		const element = event.currentTarget;
		const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
		if (nearBottom && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
	};
	if (query.isLoading) return <div className="mt-0.5 h-7.5 animate-pulse rounded-lg bg-foreground/5" />;
	if (sessions.length === 0) return null;
	return (
		<div className="mt-0.5 max-h-64 overflow-y-auto overscroll-contain scrollbar-auto" onScroll={onScroll}>
			<div className="space-y-0.5">{sessions.map((session) => renderSession(session))}</div>
		</div>
	);
}
