import { getErrorMessage } from "@jai/common";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { matchPath, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { useChat } from "@/hooks/use-chat";
import { desktop } from "@/lib/desktop";
import {
	desktopQueryClient,
	desktopQueryKeys,
	getRecentSessions,
	getRunningSessionIds,
	removeRecentSession,
	sessionRecentsQueryOptions,
	upsertProject,
	upsertRecentSession,
} from "@/lib/desktop-query";
import { cn } from "@/lib/utils";
import { selectDraft, useDesktopChatStore } from "@/stores/chat";
import {
	type DesktopProject,
	type DesktopProviderConfigInput,
	isDesktopProviderModelRunnable,
} from "../../../shared/desktop-rpc";
import { ChatColumn } from "./chat/chat-column";
import { ChatComposer } from "./chat/chat-composer";
import { ChatsPage } from "./chats-page";
import { ProjectPage, ProjectsPage } from "./projects-page";
import { ProviderSettingsDialog } from "./settings/provider-settings-dialog";
import { Sidebar } from "./sidebar/sidebar";
import { TaskPanel } from "./task-panel";

const MIN_SIDEBAR_WIDTH = 200;
const DEFAULT_SIDEBAR_WIDTH = 264;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_CHAT_WIDTH = 420;
const TASK_PANEL_WIDTH = 336;
const KEYBOARD_RESIZE_STEP = 16;
const SIDEBAR_SPRING = {
	type: "spring" as const,
	stiffness: 520,
	damping: 34,
	mass: 0.75,
	restDelta: 0.2,
	restSpeed: 0.2,
};

export function AppShell() {
	const location = useLocation();
	const navigate = useNavigate();
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [rightPanelOpen, setRightPanelOpen] = useState(true);
	const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
	const storedSessionId = useDesktopChatStore((state) => state.activeSessionId);
	const draft = useDesktopChatStore(selectDraft);
	const queue = useDesktopChatStore((state) => state.queue);
	const selectedProjectId = useDesktopChatStore((state) => state.selectedProjectId);
	const selectedModelRef = useDesktopChatStore((state) => state.selectedModelRef);
	const selectedAgentMode = useDesktopChatStore((state) => state.selectedAgentMode);
	const openSessionInStore = useDesktopChatStore((state) => state.openSession);
	const newChat = useDesktopChatStore((state) => state.newChat);
	const setDraft = useDesktopChatStore((state) => state.setDraft);
	const sessionCreated = useDesktopChatStore((state) => state.sessionCreated);
	const acceptDraft = useDesktopChatStore((state) => state.acceptDraft);
	const enqueueMessage = useDesktopChatStore((state) => state.enqueueMessage);
	const acceptQueuedMessage = useDesktopChatStore((state) => state.acceptQueuedMessage);
	const editQueuedMessage = useDesktopChatStore((state) => state.editQueuedMessage);
	const removeQueuedMessage = useDesktopChatStore((state) => state.removeQueuedMessage);
	const reorderQueuedMessages = useDesktopChatStore((state) => state.reorderQueuedMessages);
	const setSelectedProjectId = useDesktopChatStore((state) => state.setSelectedProjectId);
	const setSelectedModelRef = useDesktopChatStore((state) => state.setSelectedModelRef);
	const setSelectedAgentMode = useDesktopChatStore((state) => state.setSelectedAgentMode);
	const chatRoute = matchPath("/chat/:sessionId", location.pathname);
	const projectRoute = matchPath("/projects/:projectId", location.pathname);
	const routeSessionId = chatRoute?.params.sessionId;
	const activeSessionId = routeSessionId && routeSessionId !== "new" ? routeSessionId : null;
	const routeProjectId = projectRoute?.params.projectId;
	const activeView =
		location.pathname === "/chats"
			? "chats"
			: location.pathname === "/projects"
				? "projects"
				: routeProjectId
					? "project"
					: "chat";
	useEffect(() => {
		if (activeSessionId) {
			if (storedSessionId !== activeSessionId) openSessionInStore(activeSessionId);
			return;
		}
		if (storedSessionId !== null) newChat();
	}, [activeSessionId, newChat, openSessionInStore, storedSessionId]);
	useEffect(() => {
		if (routeProjectId) setSelectedProjectId(routeProjectId);
	}, [routeProjectId, setSelectedProjectId]);
	const projectsQuery = useQuery({
		queryKey: desktopQueryKeys.projects,
		queryFn: () => desktop.project.list(),
	});
	const providerQuery = useQuery({
		queryKey: desktopQueryKeys.providerConfig,
		queryFn: () => desktop.provider.get(),
	});
	useEffect(() => {
		return window.desktopRpc.onAgentEvent((envelope) => {
			if (envelope.event.type === "model_catalog_updated") void providerQuery.refetch();
		});
	}, [providerQuery.refetch]);
	const sessionRecentsQuery = useInfiniteQuery(sessionRecentsQueryOptions());
	const sessions = getRecentSessions(sessionRecentsQuery.data);
	const runningSessionIds = getRunningSessionIds(sessionRecentsQuery.data);
	const session = sessions.find((candidate) => candidate.id === activeSessionId);
	const projects = projectsQuery.data ?? [];
	const selectedProject = projects.find((candidate) => candidate.id === selectedProjectId);
	const defaultProject = projects.find((candidate) => candidate.available) ?? projects[0];
	const projectId = session?.projectId ?? selectedProject?.id ?? defaultProject?.id ?? null;
	const newSessionProjectId = routeProjectId ?? projectId;
	const project = projects.find((candidate) => candidate.id === projectId);
	const enabledModelRefs =
		providerQuery.data?.profiles.flatMap((profile) =>
			profile.models
				.filter((model) => model.enabled && isDesktopProviderModelRunnable(model))
				.map((model) => `${profile.id}/${model.id}`),
		) ?? [];
	const runtimeModelRef = enabledModelRefs.includes(selectedModelRef) ? selectedModelRef : (enabledModelRefs[0] ?? "");
	const chat = useChat({
		id: activeSessionId,
		newSessionProjectId,
		modelRef: runtimeModelRef,
		mode: selectedAgentMode,
		queue,
		onSessionCreated: (sessionId) => {
			sessionCreated(sessionId);
			navigate(`/chat/${sessionId}`, { replace: true });
		},
		onDraftAccepted: acceptDraft,
		onMessageQueued: enqueueMessage,
		onQueuedMessageAccepted: acceptQueuedMessage,
	});
	const shellRef = useRef<HTMLDivElement>(null);
	const chatVisible = activeView === "chat";
	const rightPanelVisible = chatVisible && rightPanelOpen && !!session;
	const sidebarResize = useSidebarResize(shellRef, rightPanelVisible);

	const updateProviderConfig = async (input: DesktopProviderConfigInput) => {
		const snapshot = await desktop.provider.save(input);
		desktopQueryClient.setQueryData(desktopQueryKeys.providerConfig, snapshot);
		return snapshot;
	};
	const fetchProviderModelsMutation = useMutation({
		mutationFn: (profileId: string) => desktop.provider.fetchModels(profileId),
		onSuccess: (result) => {
			desktopQueryClient.setQueryData(desktopQueryKeys.providerConfig, result.snapshot);
		},
	});
	const fetchProviderModels = (profileId: string) => fetchProviderModelsMutation.mutateAsync(profileId);
	const revealProviderApiKey = async (profileId: string) => {
		const result = await desktop.provider.revealApiKey(profileId);
		return result.apiKey;
	};
	const openProviderSettings = useCallback(() => {
		if (chat.status === "streaming" || chat.status === "submitted") return;
		setProviderSettingsOpen(true);
		void providerQuery.refetch();
	}, [chat.status, providerQuery.refetch]);
	useEffect(() => {
		const openSettingsShortcut = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "," || (!event.metaKey && !event.ctrlKey)) return;
			event.preventDefault();
			openProviderSettings();
		};
		window.addEventListener("keydown", openSettingsShortcut);
		return () => window.removeEventListener("keydown", openSettingsShortcut);
	}, [openProviderSettings]);
	const projectSelectionMutation = useMutation({
		mutationFn: async (candidate?: DesktopProject) => {
			const next = candidate
				? candidate.available
					? candidate
					: await desktop.project.relink(candidate.id)
				: await desktop.project.choose();
			if (!next || !session || session.projectId === next.id) return { project: next };
			const moved = await desktop.session.move({ sessionId: session.id, toProjectId: next.id });
			return { project: next, moved };
		},
		onSuccess: ({ project: next, moved }) => {
			if (!next) return;
			upsertProject(next);
			if (moved) {
				upsertRecentSession(moved);
				void desktopQueryClient.invalidateQueries({ queryKey: desktopQueryKeys.sessions.recents });
			}
			setSelectedProjectId(next.id);
		},
	});
	const projectCreationMutation = useMutation({
		mutationFn: () => desktop.project.choose(),
		onSuccess: (next) => {
			if (!next) return;
			upsertProject(next);
			setSelectedProjectId(next.id);
		},
	});
	const projectBusy = projectSelectionMutation.isPending;
	const projectError = projectSelectionMutation.isError ? getErrorMessage(projectSelectionMutation.error) : undefined;
	const chooseProject = async (candidate: DesktopProject) => {
		if (projectBusy) return;
		try {
			await projectSelectionMutation.mutateAsync(candidate);
		} catch {
			// Mutation state drives the recoverable project error UI.
		}
	};
	const addProject = async () => {
		if (projectBusy) return;
		try {
			await projectSelectionMutation.mutateAsync(undefined);
		} catch {
			// Mutation state drives the recoverable project error UI.
		}
	};
	const createProject = async () => {
		if (projectCreationMutation.isPending) return;
		try {
			const next = await projectCreationMutation.mutateAsync();
			if (next) navigate(`/projects/${next.id}`);
		} catch {
			// Mutation state drives the recoverable project error UI.
		}
	};
	const openNewChat = () => {
		newChat();
		navigate("/chat/new");
	};
	const openSession = (sessionId: string) => {
		openSessionInStore(sessionId);
		navigate(`/chat/${sessionId}`);
	};
	const openProject = (nextProject: DesktopProject) => {
		newChat();
		setSelectedProjectId(nextProject.id);
		navigate(`/projects/${nextProject.id}`);
	};
	const renameSession = async (sessionId: string, title: string) => {
		const renamed = await desktop.session.rename({ sessionId, title });
		upsertRecentSession(renamed);
	};
	const moveSession = async (sessionId: string, toProjectId: string | null) => {
		const moved = await desktop.session.move({ sessionId, toProjectId });
		upsertRecentSession(moved);
	};
	const deleteSession = async (sessionId: string) => {
		await desktop.session.delete({ sessionId });
		removeRecentSession(sessionId);
		if (activeSessionId === sessionId) openNewChat();
		void desktopQueryClient.invalidateQueries({ queryKey: desktopQueryKeys.sessions.recents });
	};
	const projectLoadErrorMessage = projectsQuery.isError ? getErrorMessage(projectsQuery.error) : undefined;
	const projectPageError = projectCreationMutation.isError
		? getErrorMessage(projectCreationMutation.error)
		: projectLoadErrorMessage;
	const sessionLoadErrorMessage = sessionRecentsQuery.isError ? getErrorMessage(sessionRecentsQuery.error) : undefined;
	const pageProject = routeProjectId ? projects.find((candidate) => candidate.id === routeProjectId) : undefined;
	const projectLoading = projectsQuery.isLoading || projectsQuery.isFetching;
	const projectLoadError = projectsQuery.isError && projectsQuery.data === undefined;
	const chatProjectError =
		projectError || (projectsQuery.isError ? "Projects could not be loaded. Open the menu to retry." : undefined);

	return (
		<div
			ref={shellRef}
			className="relative flex h-screen min-h-160 min-w-5xl overflow-hidden bg-background text-foreground"
		>
			{sidebarOpen ? (
				<Sidebar
					activeView={activeView}
					sessions={sessions}
					projects={projects}
					runningSessionIds={runningSessionIds}
					activeSessionId={chatVisible ? activeSessionId : null}
					loading={sessionRecentsQuery.isLoading}
					error={sessionLoadErrorMessage}
					hasNextPage={sessionRecentsQuery.hasNextPage}
					loadingMore={sessionRecentsQuery.isFetchingNextPage}
					width={sidebarResize.width}
					settingsDisabled={chat.status === "streaming" || chat.status === "submitted"}
					onToggleSidebar={() => setSidebarOpen(false)}
					onNewChat={openNewChat}
					onOpenChats={() => navigate("/chats")}
					onOpenProjects={() => navigate("/projects")}
					onOpenSettings={openProviderSettings}
					onSelectSession={openSession}
					onRenameSession={renameSession}
					onMoveSession={moveSession}
					onDeleteSession={deleteSession}
					onLoadMore={() => void sessionRecentsQuery.fetchNextPage()}
				/>
			) : null}
			{sidebarOpen ? <SidebarResizeHandle {...sidebarResize} /> : null}
			<Routes>
				<Route
					path="/chats"
					element={
						<ChatsPage
							sessions={sessions}
							projects={projects}
							loading={sessionRecentsQuery.isLoading}
							error={sessionLoadErrorMessage}
							hasNextPage={sessionRecentsQuery.hasNextPage}
							loadingMore={sessionRecentsQuery.isFetchingNextPage}
							onNewChat={openNewChat}
							onSelectSession={openSession}
							onLoadMore={() => void sessionRecentsQuery.fetchNextPage()}
						/>
					}
				/>
				<Route
					path="/projects"
					element={
						<ProjectsPage
							projects={projects}
							sessions={sessions}
							loading={projectLoading}
							error={projectPageError}
							adding={projectCreationMutation.isPending}
							onAddProject={() => void createProject()}
							onOpenProject={openProject}
						/>
					}
				/>
				<Route
					path="/projects/:projectId"
					element={
						pageProject ? (
							<ProjectPage
								project={pageProject}
								sessions={sessions}
								onBack={() => navigate("/projects")}
								onSelectSession={openSession}
								composer={
									<ChatComposer
										value={draft}
										onValueChange={setDraft}
										onSend={chat.sendMessage}
										onStop={chat.stop}
										status={chat.status}
										disabled={!pageProject.available}
										queue={queue}
										onEditQueuedMessage={editQueuedMessage}
										onRemoveQueuedMessage={removeQueuedMessage}
										onReorderQueuedMessages={reorderQueuedMessages}
										project={pageProject}
										projects={projects}
										projectBusy={projectBusy}
										projectLoading={projectLoading}
										projectLoadError={projectLoadError}
										onChooseProject={chooseProject}
										onAddProject={addProject}
										onRetryProjects={() => void projectsQuery.refetch()}
										providerConfig={providerQuery.data}
										selectedModelRef={runtimeModelRef}
										selectedAgentMode={selectedAgentMode}
										providerLoading={providerQuery.isLoading}
										providerError={providerQuery.isError}
										onOpenProviderSettings={openProviderSettings}
										onSelectProviderModel={setSelectedModelRef}
										onSelectAgentMode={setSelectedAgentMode}
										showProjectPicker={false}
										large
									/>
								}
							/>
						) : (
							<ProjectsPage
								projects={projects}
								sessions={sessions}
								loading={projectLoading}
								error={projectPageError}
								adding={projectCreationMutation.isPending}
								onAddProject={() => void createProject()}
								onOpenProject={openProject}
							/>
						)
					}
				/>
				<Route
					path="/chat/:sessionId"
					element={
						<ChatColumn
							key={activeSessionId ?? "new"}
							session={session}
							project={project}
							projects={projects}
							chat={chat}
							draft={draft}
							queue={queue}
							onDraftChange={setDraft}
							onEditQueuedMessage={editQueuedMessage}
							onRemoveQueuedMessage={removeQueuedMessage}
							onReorderQueuedMessages={reorderQueuedMessages}
							providerConfig={providerQuery.data}
							selectedModelRef={runtimeModelRef}
							selectedAgentMode={selectedAgentMode}
							providerLoading={providerQuery.isLoading}
							providerError={providerQuery.isError}
							projectBusy={projectBusy}
							projectLoading={projectLoading}
							projectLoadError={projectLoadError}
							projectError={chatProjectError}
							sidebarOpen={sidebarOpen}
							rightPanelOpen={rightPanelVisible}
							onToggleSidebar={() => setSidebarOpen(true)}
							onToggleRightPanel={() => setRightPanelOpen((open) => !open)}
							onOpenProviderSettings={openProviderSettings}
							onSelectProviderModel={setSelectedModelRef}
							onSelectAgentMode={setSelectedAgentMode}
							onChooseProject={chooseProject}
							onAddProject={addProject}
							onRetryProjects={() => void projectsQuery.refetch()}
							onRenameSession={renameSession}
						/>
					}
				/>
				<Route path="*" element={<Navigate to="/chat/new" replace />} />
			</Routes>
			{rightPanelVisible ? (
				<TaskPanel status={chat.status === "streaming" ? "running" : "idle"} todos={chat.todos} project={project} />
			) : null}
			<ProviderSettingsDialog
				open={providerSettingsOpen}
				snapshot={providerQuery.data}
				loading={providerQuery.isLoading || providerQuery.isFetching}
				loadError={providerQuery.isError && !providerQuery.isFetching}
				onOpenChange={setProviderSettingsOpen}
				onRetry={() => void providerQuery.refetch()}
				onSave={updateProviderConfig}
				onFetchModels={fetchProviderModels}
				onRevealApiKey={revealProviderApiKey}
			/>
		</div>
	);
}

function rubberBand(distance: number, dimension = DEFAULT_SIDEBAR_WIDTH, constant = 0.55): number {
	return (distance * dimension * constant) / (dimension + constant * distance);
}

function applyResizeResistance(value: number, min: number, max: number): number {
	if (value < min) return min - rubberBand(min - value);
	if (value > max) return max + rubberBand(value - max);
	return value;
}

function useSidebarResize(stageRef: RefObject<HTMLDivElement | null>, rightPanelVisible: boolean) {
	const width = useMotionValue(DEFAULT_SIDEBAR_WIDTH);
	const reduceMotion = useReducedMotion() ?? false;
	const dragRef = useRef({ pointerId: -1, startX: 0, startWidth: DEFAULT_SIDEBAR_WIDTH });
	const [limits, setLimits] = useState({ min: MIN_SIDEBAR_WIDTH, max: MAX_SIDEBAR_WIDTH });
	const [announcedWidth, setAnnouncedWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
	const [isDragging, setIsDragging] = useState(false);

	const settle = useCallback(
		(target: number) => {
			const bounded = Math.min(limits.max, Math.max(limits.min, target));
			if (reduceMotion) {
				width.set(bounded);
			} else {
				animate(width, bounded, SIDEBAR_SPRING);
			}
			setAnnouncedWidth(Math.round(bounded));
		},
		[limits.max, limits.min, reduceMotion, width],
	);

	// ResizeObserver is the external integration that keeps the elastic boundary
	// aligned with the actual window and the optional task panel.
	useEffect(() => {
		const stage = stageRef.current;
		if (!stage) return;

		const updateLimits = () => {
			const reservedWidth = rightPanelVisible ? TASK_PANEL_WIDTH : 0;
			const available = stage.getBoundingClientRect().width - MIN_CHAT_WIDTH - reservedWidth;
			const max = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, available));
			setLimits({ min: MIN_SIDEBAR_WIDTH, max });
			if (width.get() > max) {
				width.set(max);
				setAnnouncedWidth(Math.round(max));
			}
		};

		updateLimits();
		const observer = new ResizeObserver(updateLimits);
		observer.observe(stage);
		return () => {
			observer.disconnect();
			document.documentElement.classList.remove("sidebar-resizing");
		};
	}, [rightPanelVisible, stageRef, width]);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: width.get(),
		};
		setIsDragging(true);
		document.documentElement.classList.add("sidebar-resizing");
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (dragRef.current.pointerId !== event.pointerId) return;
		const nextWidth = dragRef.current.startWidth + event.clientX - dragRef.current.startX;
		width.set(applyResizeResistance(nextWidth, limits.min, limits.max));
	};

	const finishPointerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (dragRef.current.pointerId !== event.pointerId) return;
		dragRef.current.pointerId = -1;
		setIsDragging(false);
		document.documentElement.classList.remove("sidebar-resizing");
		settle(width.get());
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		let nextWidth = width.get();
		if (event.key === "ArrowLeft") nextWidth -= KEYBOARD_RESIZE_STEP;
		else if (event.key === "ArrowRight") nextWidth += KEYBOARD_RESIZE_STEP;
		else if (event.key === "Home") nextWidth = limits.min;
		else if (event.key === "End") nextWidth = limits.max;
		else return;

		event.preventDefault();
		settle(nextWidth);
	};

	return {
		width,
		limits,
		announcedWidth,
		isDragging,
		onPointerDown,
		onPointerMove,
		onPointerUp: finishPointerResize,
		onPointerCancel: finishPointerResize,
		onLostPointerCapture: finishPointerResize,
		onKeyDown,
	};
}

function SidebarResizeHandle({
	width,
	limits,
	announcedWidth,
	isDragging,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onLostPointerCapture,
	onKeyDown,
}: ReturnType<typeof useSidebarResize>) {
	return (
		<motion.div
			role="separator"
			aria-label="调整侧边栏宽度"
			aria-orientation="vertical"
			aria-valuemin={Math.round(limits.min)}
			aria-valuemax={Math.round(limits.max)}
			aria-valuenow={announcedWidth}
			aria-valuetext={`${announcedWidth} 像素`}
			tabIndex={0}
			data-dragging={isDragging}
			className="group absolute top-0 bottom-0 left-0 z-20 -ml-3 w-6 cursor-col-resize touch-none outline-none"
			style={{ x: width, outline: "none" }}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onLostPointerCapture={onLostPointerCapture}
			onKeyDown={onKeyDown}
		>
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute top-1/2 left-1/2 h-6 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,transform,background-color] duration-150 group-hover:scale-y-100 group-hover:bg-muted-foreground/35 group-hover:opacity-100 group-focus-visible:scale-y-100 group-focus-visible:bg-primary-2 group-focus-visible:opacity-100",
					{
						"scale-y-100 bg-primary-2/70 opacity-100": isDragging,
						"scale-y-75 bg-transparent opacity-0": !isDragging,
					},
				)}
			/>
		</motion.div>
	);
}
