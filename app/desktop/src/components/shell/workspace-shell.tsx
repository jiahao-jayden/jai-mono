import { getErrorMessage } from "@jai/common";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import {
	type EffectCallback,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { desktop } from "@/lib/desktop";
import { useActiveSessionStore, useSessionListStore } from "@/stores/sessions";
import type {
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopWorkspace,
} from "../../../shared/desktop-rpc";
import { ChatColumn } from "./chat-column";
import { ProviderSettingsDialog } from "./provider-settings-dialog";
import { Sidebar } from "./sidebar";
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

export function WorkspaceShell() {
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [rightPanelOpen, setRightPanelOpen] = useState(true);
	const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
	const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
	const [workspaceBusy, setWorkspaceBusy] = useState(false);
	const [workspaceError, setWorkspaceError] = useState<string>();
	const [modelSwitching, setModelSwitching] = useState(false);
	const [modelSwitchError, setModelSwitchError] = useState<string>();
	const queryClient = useQueryClient();
	const sessionList = useSessionListStore();
	const activeSession = useActiveSessionStore();
	const workspacesQuery = useQuery({
		queryKey: ["workspaces"],
		queryFn: () => desktop.workspace.list(),
		staleTime: 30_000,
	});
	const providerQuery = useQuery({
		queryKey: ["provider-config"],
		queryFn: () => desktop.provider.get(),
		staleTime: 30_000,
	});

	useMountEffect(() => {
		void useSessionListStore.getState().refresh();
	});

	const session = sessionList.sessions.find((candidate) => candidate.id === activeSession.sessionId);
	const workspaces = workspacesQuery.data ?? [];
	const selectedWorkspace = workspaces.find((candidate) => candidate.id === selectedWorkspaceId);
	const defaultWorkspace = workspaces.find((candidate) => candidate.available) ?? workspaces[0];
	const workspaceId = session?.workspaceId ?? selectedWorkspace?.id ?? defaultWorkspace?.id ?? null;
	const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
	const shellRef = useRef<HTMLDivElement>(null);
	const sidebarResize = useSidebarResize(shellRef, rightPanelOpen && !!session);

	const send = async (message: string) => {
		if (activeSession.sessionId) {
			await activeSession.send(message);
			return;
		}
		await activeSession.createAndSend(workspaceId, message);
	};
	const updateProviderConfig = async (input: DesktopProviderConfigInput) => {
		const snapshot = await desktop.provider.save(input);
		queryClient.setQueryData(["provider-config"], snapshot);
		return snapshot;
	};
	const saveProviderConfig = async (input: DesktopProviderConfigInput) => {
		await updateProviderConfig(input);
		setProviderSettingsOpen(false);
	};
	const openProviderSettings = useCallback(() => {
		if (activeSession.status === "running") return;
		setProviderSettingsOpen(true);
		if (providerQuery.isError) void providerQuery.refetch();
	}, [activeSession.status, providerQuery.isError, providerQuery.refetch]);
	const selectProviderModel = async (modelRef: string) => {
		const snapshot = providerQuery.data;
		if (!snapshot || snapshot.activeModelRef === modelRef || modelSwitching) return;
		setModelSwitching(true);
		setModelSwitchError(undefined);
		try {
			await updateProviderConfig(toProviderConfigInput(snapshot, modelRef));
		} catch (error) {
			setModelSwitchError(getErrorMessage(error));
		} finally {
			setModelSwitching(false);
		}
	};

	useEffect(() => {
		const openSettingsShortcut = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "," || (!event.metaKey && !event.ctrlKey)) return;
			event.preventDefault();
			openProviderSettings();
		};
		window.addEventListener("keydown", openSettingsShortcut);
		return () => window.removeEventListener("keydown", openSettingsShortcut);
	}, [openProviderSettings]);
	const rememberWorkspace = (next: DesktopWorkspace) => {
		queryClient.setQueryData<DesktopWorkspace[]>(["workspaces"], (current = []) => {
			const index = current.findIndex((candidate) => candidate.id === next.id);
			if (index < 0) return [...current, next];
			const updated = [...current];
			updated[index] = next;
			return updated;
		});
	};
	const bindWorkspace = async (next: DesktopWorkspace) => {
		if (!session) {
			setSelectedWorkspaceId(next.id);
			return;
		}
		if (session.workspaceId === next.id) {
			setSelectedWorkspaceId(next.id);
			return;
		}
		const moved = await desktop.session.move({ sessionId: session.id, toWorkspaceId: next.id });
		sessionList.upsert(moved);
		setSelectedWorkspaceId(next.id);
		void sessionList.refresh();
	};
	const chooseWorkspace = async (candidate: DesktopWorkspace) => {
		if (workspaceBusy) return;
		setWorkspaceBusy(true);
		setWorkspaceError(undefined);
		try {
			let next = candidate;
			if (!candidate.available) {
				const relinked = await desktop.workspace.relink(candidate.id);
				if (!relinked) return;
				next = relinked;
				rememberWorkspace(relinked);
			}
			await bindWorkspace(next);
		} catch (error) {
			setWorkspaceError(getErrorMessage(error));
		} finally {
			setWorkspaceBusy(false);
		}
	};
	const addWorkspace = async () => {
		if (workspaceBusy) return;
		setWorkspaceBusy(true);
		setWorkspaceError(undefined);
		try {
			const created = await desktop.workspace.choose();
			if (!created) return;
			rememberWorkspace(created);
			await bindWorkspace(created);
		} catch (error) {
			setWorkspaceError(getErrorMessage(error));
		} finally {
			setWorkspaceBusy(false);
		}
	};

	return (
		<div
			ref={shellRef}
			className="relative flex h-screen min-h-160 min-w-5xl overflow-hidden bg-background text-foreground"
		>
			{sidebarOpen ? (
				<Sidebar
					sessions={sessionList.sessions}
					runningSessionIds={sessionList.runningSessionIds}
					activeSessionId={activeSession.sessionId}
					loading={sessionList.loading}
					error={sessionList.error}
					width={sidebarResize.width}
					settingsDisabled={activeSession.status === "running"}
					onToggleSidebar={() => setSidebarOpen(false)}
					onNewChat={activeSession.newChat}
					onOpenSettings={openProviderSettings}
					onSelectSession={activeSession.open}
				/>
			) : null}
			{sidebarOpen ? <SidebarResizeHandle {...sidebarResize} /> : null}
			<ChatColumn
				key={activeSession.sessionId ?? "new"}
				session={session}
				workspace={workspace}
				workspaces={workspaces}
				status={activeSession.status}
				items={activeSession.items}
				loading={activeSession.loading}
				error={activeSession.error}
				providerConfig={providerQuery.data}
				providerLoading={providerQuery.isLoading}
				providerError={providerQuery.isError}
				modelSwitching={modelSwitching}
				modelSwitchError={modelSwitchError}
				workspaceBusy={workspaceBusy}
				workspaceLoading={workspacesQuery.isLoading || workspacesQuery.isFetching}
				workspaceLoadError={workspacesQuery.isError && workspacesQuery.data === undefined}
				workspaceError={
					workspaceError ||
					(workspacesQuery.isError ? "Workspaces could not be loaded. Open the menu to retry." : undefined)
				}
				sidebarOpen={sidebarOpen}
				rightPanelOpen={rightPanelOpen && !!session}
				onToggleSidebar={() => setSidebarOpen(true)}
				onToggleRightPanel={() => setRightPanelOpen((open) => !open)}
				onOpenProviderSettings={openProviderSettings}
				onSelectProviderModel={selectProviderModel}
				onChooseWorkspace={chooseWorkspace}
				onAddWorkspace={addWorkspace}
				onRetryWorkspaces={() => void workspacesQuery.refetch()}
				onSend={send}
				onAbort={activeSession.abort}
				onResolvePermission={activeSession.resolvePermission}
			/>
			{rightPanelOpen && session ? (
				<TaskPanel status={activeSession.status} items={activeSession.items} workspace={workspace} />
			) : null}
			<ProviderSettingsDialog
				open={providerSettingsOpen}
				snapshot={providerQuery.data}
				loading={providerQuery.isLoading || providerQuery.isFetching}
				loadError={providerQuery.isError && !providerQuery.isFetching}
				onOpenChange={setProviderSettingsOpen}
				onRetry={() => void providerQuery.refetch()}
				onSave={saveProviderConfig}
			/>
		</div>
	);
}

function toProviderConfigInput(
	snapshot: DesktopProviderConfigSnapshot,
	activeModelRef: string,
): DesktopProviderConfigInput {
	return {
		revision: snapshot.revision,
		activeModelRef,
		profiles: snapshot.profiles.map(
			({ credentialConfigured: _configured, credentialMask: _mask, ...profile }) => profile,
		),
	};
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
				className={`pointer-events-none absolute top-1/2 left-1/2 h-6 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,transform,background-color] duration-150 group-hover:scale-y-100 group-hover:bg-muted-foreground/35 group-hover:opacity-100 group-focus-visible:scale-y-100 group-focus-visible:bg-primary-2 group-focus-visible:opacity-100 ${
					isDragging ? "scale-y-100 bg-primary-2/70 opacity-100" : "scale-y-75 bg-transparent opacity-0"
				}`}
			/>
		</motion.div>
	);
}

function useMountEffect(effect: EffectCallback) {
	// Session list hydration is an external store integration and only runs once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: named mount-only integration
	useEffect(effect, []);
}
