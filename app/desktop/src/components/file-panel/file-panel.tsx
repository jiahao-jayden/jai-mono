import { PanelLeftCloseIcon, PanelLeftIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useElementWidth } from "@/hooks/use-element-width";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useChatStore } from "@/stores/chat";
import { useFilePanelStore } from "@/stores/file-panel";
import { useSessionStore } from "@/stores/session";
import { FileTree } from "./file-tree";
import { FileViewer } from "./file-viewer";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const NARROW_BREAKPOINT = 480;
const DRAWER_WIDTH = 280;

type ResolvedMode = "tree-only" | "pinned" | "collapsed";

function TreeSkeleton() {
	const rows = useMemo(
		() =>
			Array.from({ length: 9 }, (_, i) => ({
				key: `tsk-${i}-${((i * 97) % 47).toString(16)}`,
				indent: (i % 3) * 12,
				width: 34 + Math.sin(i * 2.1) * 22,
				delay: i * 60,
			})),
		[],
	);
	return (
		<div className="flex flex-col gap-1.75 px-3 py-2.5">
			{rows.map((r) => (
				<div
					key={r.key}
					className="flex items-center gap-2"
					style={{ paddingLeft: `${r.indent}px`, animationDelay: `${r.delay}ms` }}
				>
					<div className="size-3.25 rounded-sm bg-foreground/5 animate-pulse" />
					<div className="h-2.75 rounded-sm bg-foreground/5 animate-pulse" style={{ width: `${r.width}%` }} />
				</div>
			))}
		</div>
	);
}

interface TreeContentProps {
	workspaceId: string;
	loading: boolean;
	paths: readonly string[];
	selectedPath: string | null;
	onSelect: (path: string) => void;
	/**
	 * `fill` — take the parent's full height (used in tree-only / pinned modes).
	 * `compact` — size to natural content height, no forced fill (used in the hover drawer
	 * so a workspace with 1–3 files doesn't render a 600px tall empty card).
	 */
	variant?: "fill" | "compact";
}

function TreeContent({ workspaceId, loading, paths, selectedPath, onSelect, variant = "fill" }: TreeContentProps) {
	const isCompact = variant === "compact";
	return (
		<div className="h-full flex flex-col overflow-hidden">
			{loading ? (
				<TreeSkeleton />
			) : paths.length === 0 ? (
				<EmptyTree compact={isCompact} />
			) : (
				<div className="pierre-trees-host h-full">
					<FileTree
						key={workspaceId}
						workspaceId={workspaceId}
						initialPaths={paths}
						selectedPath={selectedPath}
						onSelect={onSelect}
						onError={(msg) => toast.error(msg)}
					/>
				</div>
			)}
		</div>
	);
}

function EmptyTree({ compact = false }: { compact?: boolean }) {
	return (
		<div
			className={cn("flex flex-col items-center justify-center gap-2 px-6 text-center", compact ? "py-8" : "h-full")}
		>
			<div aria-hidden className="mb-1 h-px w-8 bg-linear-to-r from-transparent via-foreground/15 to-transparent" />
			<p className="font-serif italic text-[13px] text-foreground/45">空书架</p>
			<p className="max-w-[18ch] text-[11px] leading-relaxed text-foreground/30">这个工作区还没有文件。</p>
		</div>
	);
}

export function FilePanel() {
	const {
		workspaceId,
		selectedPath,
		openPaths,
		openFile,
		closeTab,
		setOpen,
		treeModePreference,
		setTreeModePreference,
	} = useFilePanelStore();
	const [paths, setPaths] = useState<readonly string[]>([]);
	const [loading, setLoading] = useState(true);

	const rootRef = useRef<HTMLDivElement>(null);
	const panelWidth = useElementWidth(rootRef);
	const isNarrow = panelWidth !== null && panelWidth < NARROW_BREAKPOINT;

	const sessionId = useChatStore((s) => s.sessionId);
	const sessions = useSessionStore((s) => s.sessions);
	const workspaceName = useMemo(() => {
		if (!sessionId) return "Workspace";
		const session = sessions.find((s) => s.sessionId === sessionId);
		if (!session?.workspaceId) return "Workspace";
		const parts = session.workspaceId.split("/");
		return parts[parts.length - 1] || "Workspace";
	}, [sessionId, sessions]);

	useEffect(() => {
		if (!workspaceId) return;
		let cancelled = false;
		setLoading(true);

		gateway.workspace
			.listPaths(workspaceId)
			.then((res) => {
				if (!cancelled) setPaths(res.paths);
			})
			.catch((err) => {
				console.error("[file-panel] load paths failed:", err);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	const [drawerOpen, setDrawerOpen] = useState(false);

	const handleSelect = useCallback(
		(path: string) => {
			openFile(path);
			setDrawerOpen(false);
		},
		[openFile],
	);

	const handleClose = useCallback(() => {
		setOpen(false);
	}, [setOpen]);

	// Three-state layout resolution:
	//  • tree-only: no file selected → tree owns the whole panel, no viewer
	//  • pinned: classic two-pane split
	//  • collapsed: viewer full-bleed + hover/click drawer
	const resolvedMode: ResolvedMode = useMemo(() => {
		if (!selectedPath) return "tree-only";
		if (treeModePreference) return treeModePreference;
		return isNarrow ? "collapsed" : "pinned";
	}, [selectedPath, treeModePreference, isNarrow]);

	useEffect(() => {
		if (resolvedMode !== "collapsed") setDrawerOpen(false);
	}, [resolvedMode]);

	const drawerHeight = useMemo(() => {
		if (loading) return 240;
		if (paths.length === 0) return 132;
		const ROW = 28;
		const SEARCH = paths.length > 6 ? 44 : 0;
		const natural = paths.length * ROW + SEARCH + 12;
		return Math.min(420, natural);
	}, [loading, paths.length]);

	const togglePinned = useCallback(() => {
		if (resolvedMode === "pinned") {
			setTreeModePreference("collapsed");
		} else {
			setTreeModePreference("pinned");
		}
	}, [resolvedMode, setTreeModePreference]);

	if (!workspaceId) return null;

	const showToggle = resolvedMode !== "tree-only";
	const toggleIsPinned = resolvedMode === "pinned";

	return (
		<div ref={rootRef} className="relative flex flex-col h-full rounded-lg bg-card overflow-hidden">
			<div className="flex items-center gap-1 px-2.5 h-11 shrink-0 border-b border-border/15" style={drag}>
				{showToggle && (
					<div className="flex items-center" style={noDrag}>
						<NavButton
							icon={
								toggleIsPinned ? (
									<PanelLeftCloseIcon className="size-3.5" />
								) : (
									<PanelLeftIcon className="size-3.5" />
								)
							}
							disabled={false}
							onClick={togglePinned}
							ariaLabel={toggleIsPinned ? "收起文件树" : "展开文件树"}
						/>
					</div>
				)}

				<div className="flex-1 min-w-0 px-1" style={noDrag}>
					{openPaths.length === 0 ? (
						<span className="font-serif italic text-[13px] text-foreground/45 truncate block pl-1">
							{workspaceName}
						</span>
					) : (
						<TabsBar
							openPaths={openPaths}
							selectedPath={selectedPath}
							onSelect={handleSelect}
							onClose={closeTab}
						/>
					)}
				</div>

				<button
					type="button"
					onClick={handleClose}
					style={noDrag}
					aria-label="关闭文件面板"
					className={cn(
						"p-1 rounded-md transition-all duration-100 ease-out",
						"text-foreground/30 hover:text-foreground hover:bg-foreground/5",
						"active:bg-foreground/10 active:scale-95",
					)}
				>
					<XIcon className="size-3.5" />
				</button>
			</div>

			<div className="relative flex-1 min-h-0">
				{resolvedMode === "tree-only" && (
					<div className="h-full">
						<TreeContent
							workspaceId={workspaceId}
							loading={loading}
							paths={paths}
							selectedPath={selectedPath}
							onSelect={handleSelect}
						/>
					</div>
				)}

				{resolvedMode === "pinned" && selectedPath && (
					<ResizablePanelGroup orientation="horizontal" id="file-panel-pinned-split">
						<ResizablePanel defaultSize="34%" minSize="22%" maxSize="60%">
							<TreeContent
								workspaceId={workspaceId}
								loading={loading}
								paths={paths}
								selectedPath={selectedPath}
								onSelect={handleSelect}
							/>
						</ResizablePanel>
						<ResizableHandle className="bg-transparent" />
						<ResizablePanel defaultSize="66%" minSize="30%">
							<div className="h-full border-l border-border/15">
								<FileViewer workspaceId={workspaceId} filePath={selectedPath} />
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				)}

				{resolvedMode === "collapsed" && selectedPath && (
					<>
						<div className="h-full">
							<FileViewer workspaceId={workspaceId} filePath={selectedPath} />
						</div>

						<HoverCard open={drawerOpen} onOpenChange={setDrawerOpen} openDelay={120} closeDelay={180}>
							<HoverCardTrigger asChild>
								<button
									type="button"
									aria-label="展开文件树"
									tabIndex={-1}
									onClick={() => setDrawerOpen(true)}
									className="absolute inset-y-0 left-0 w-3 z-10 cursor-default bg-transparent"
								/>
							</HoverCardTrigger>
							<HoverCardContent
								side="right"
								align="start"
								sideOffset={6}
								avoidCollisions={false}
								collisionPadding={8}
								className="p-0 overflow-hidden"
								style={{ width: `${DRAWER_WIDTH}px`, height: `${drawerHeight}px` }}
							>
								<TreeContent
									variant="compact"
									workspaceId={workspaceId}
									loading={loading}
									paths={paths}
									selectedPath={selectedPath}
									onSelect={handleSelect}
								/>
							</HoverCardContent>
						</HoverCard>
					</>
				)}
			</div>
		</div>
	);
}

interface NavButtonProps {
	icon: React.ReactNode;
	disabled: boolean;
	onClick: () => void;
	ariaLabel?: string;
}

function NavButton({ icon, disabled, onClick, ariaLabel }: NavButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={ariaLabel}
			className={cn(
				"p-1 rounded-md transition-all duration-100 ease-out",
				disabled
					? "text-foreground/15 pointer-events-none"
					: "text-foreground/45 hover:text-foreground hover:bg-foreground/5 active:bg-foreground/10 active:scale-95",
			)}
		>
			{icon}
		</button>
	);
}

interface TabsBarProps {
	openPaths: readonly string[];
	selectedPath: string | null;
	onSelect: (path: string) => void;
	onClose: (path: string) => void;
}

function TabsBar({ openPaths, selectedPath, onSelect, onClose }: TabsBarProps) {
	const activeTabRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!selectedPath) return;
		activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [selectedPath]);

	return (
		<div className="flex items-center gap-0.5 overflow-x-auto -mx-0.5 px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			{openPaths.map((path) => (
				<FileTab
					key={path}
					ref={path === selectedPath ? activeTabRef : undefined}
					path={path}
					active={path === selectedPath}
					onActivate={() => onSelect(path)}
					onClose={() => onClose(path)}
				/>
			))}
		</div>
	);
}

interface FileTabProps {
	path: string;
	active: boolean;
	onActivate: () => void;
	onClose: () => void;
	ref?: React.Ref<HTMLDivElement>;
}

function FileTab({ path, active, onActivate, onClose, ref }: FileTabProps) {
	const name = path.split("/").pop() || path;

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				onClose();
			}
		},
		[onClose],
	);

	const handleCloseClick = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			onClose();
		},
		[onClose],
	);

	return (
		<div
			ref={ref}
			className={cn(
				"group/tab shrink-0 flex items-center gap-1 h-7 pl-2 pr-1 rounded-md max-w-45 text-[12px] transition-colors select-none",
				active
					? "bg-foreground/6 text-foreground"
					: "text-foreground/55 hover:bg-foreground/4 hover:text-foreground/85",
			)}
		>
			<button
				type="button"
				onClick={onActivate}
				onMouseDown={handleMouseDown}
				className="flex-1 min-w-0 text-left truncate cursor-pointer"
				title={path}
			>
				{name}
			</button>
			<button
				type="button"
				onClick={handleCloseClick}
				aria-label={`关闭 ${name}`}
				className={cn(
					"p-0.5 rounded shrink-0 transition-opacity cursor-pointer",
					"hover:bg-foreground/10 hover:text-foreground",
					active ? "opacity-60" : "opacity-0 group-hover/tab:opacity-60",
					"focus-visible:opacity-100",
				)}
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}
