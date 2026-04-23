import type { FileEntry } from "@jayden/jai-gateway";
import { ArrowLeftIcon, ArrowRightIcon, FilePlusIcon, FolderOpenIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useChatStore } from "@/stores/chat";
import { useFilePanelStore } from "@/stores/file-panel";
import { useSessionStore } from "@/stores/session";
import { FileTree } from "./file-tree";
import { FileViewer } from "./file-viewer";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

function TreeSkeleton() {
	return (
		<div className="flex flex-col gap-1.5 px-3 py-3">
			{Array.from({ length: 10 }, (_, i) => (
				<div key={`skeleton-${i}`} className="flex items-center gap-2" style={{ paddingLeft: `${(i % 3) * 14}px` }}>
					<div className="size-3.5 rounded bg-foreground/4 animate-pulse" />
					<div
						className="h-3.5 rounded bg-foreground/4 animate-pulse"
						style={{ width: `${40 + Math.sin(i * 2.1) * 25}%` }}
					/>
				</div>
			))}
		</div>
	);
}

function TreeContent({
	workspaceId,
	workspaceName,
	loading,
	entries,
	selectedPath,
	onSelect,
}: {
	workspaceId: string;
	workspaceName: string;
	loading: boolean;
	entries: FileEntry[];
	selectedPath: string | null;
	onSelect: (path: string, mimeType?: string) => void;
}) {
	return (
		<div className="h-full flex flex-col overflow-hidden">
			<div className="flex items-center gap-1.5 px-3 h-7 shrink-0 text-[10px] font-semibold text-foreground/35 uppercase tracking-widest">
				{workspaceName}
			</div>

			<div className="flex-1 min-h-0 overflow-auto">
				{loading ? (
					<TreeSkeleton />
				) : entries.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-2 py-12 text-foreground/20">
						<FolderOpenIcon className="size-8 stroke-1" />
						<span className="text-[12px]">No files</span>
					</div>
				) : (
					<FileTree workspaceId={workspaceId} entries={entries} selectedPath={selectedPath} onSelect={onSelect} />
				)}
			</div>
		</div>
	);
}

export function FilePanel() {
	const { workspaceId, selectedPath, openFile, setOpen } = useFilePanelStore();
	const [entries, setEntries] = useState<FileEntry[]>([]);
	const [loading, setLoading] = useState(true);

	const historyRef = useRef<string[]>([]);
	const historyIdxRef = useRef(-1);
	const [, forceUpdate] = useState(0);

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
			.listFiles(workspaceId, "", 1)
			.then((res) => {
				if (!cancelled) setEntries(res.entries);
			})
			.catch((err) => {
				console.error("[file-panel] load root failed:", err);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	const handleSelect = useCallback(
		(path: string) => {
			const h = historyRef.current;
			const idx = historyIdxRef.current;
			historyRef.current = [...h.slice(0, idx + 1), path];
			historyIdxRef.current = historyRef.current.length - 1;
			openFile(path);
			forceUpdate((n) => n + 1);
		},
		[openFile],
	);

	const canGoBack = historyIdxRef.current > 0;
	const canGoForward = historyIdxRef.current < historyRef.current.length - 1;

	const goBack = useCallback(() => {
		if (historyIdxRef.current <= 0) return;
		historyIdxRef.current -= 1;
		openFile(historyRef.current[historyIdxRef.current]);
		forceUpdate((n) => n + 1);
	}, [openFile]);

	const goForward = useCallback(() => {
		if (historyIdxRef.current >= historyRef.current.length - 1) return;
		historyIdxRef.current += 1;
		openFile(historyRef.current[historyIdxRef.current]);
		forceUpdate((n) => n + 1);
	}, [openFile]);

	const handleClose = useCallback(() => {
		setOpen(false);
	}, [setOpen]);

	const fileName = selectedPath?.split("/").pop() ?? null;

	if (!workspaceId) return null;

	return (
		<div className="flex flex-col h-full rounded-lg bg-card overflow-hidden">
			<div className="flex items-center gap-1 px-2 h-11 shrink-0 border-b border-border/20" style={drag}>
				<div className="flex items-center gap-0.5" style={noDrag}>
					<button
						type="button"
						onClick={goBack}
						disabled={!canGoBack}
						className={cn(
							"p-1 rounded-md transition-all duration-75",
							canGoBack
								? "text-foreground/50 hover:text-foreground hover:bg-foreground/6 active:bg-foreground/10 active:scale-95"
								: "text-foreground/15 pointer-events-none",
						)}
					>
						<ArrowLeftIcon className="size-3.5" />
					</button>
					<button
						type="button"
						onClick={goForward}
						disabled={!canGoForward}
						className={cn(
							"p-1 rounded-md transition-all duration-75",
							canGoForward
								? "text-foreground/50 hover:text-foreground hover:bg-foreground/6 active:bg-foreground/10 active:scale-95"
								: "text-foreground/15 pointer-events-none",
						)}
					>
						<ArrowRightIcon className="size-3.5" />
					</button>
				</div>

				<div className="flex-1 min-w-0 flex items-center px-1">
					{fileName ? (
						<span className="text-[13px] font-medium text-foreground truncate">{fileName}</span>
					) : (
						<span className="text-[12px] text-foreground/30">{workspaceName}</span>
					)}
				</div>

				<button
					type="button"
					onClick={handleClose}
					style={noDrag}
					className="p-1 rounded-md transition-all duration-75 text-foreground/30 hover:text-foreground hover:bg-foreground/6 active:bg-foreground/10 active:scale-95"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>

			<div className="flex-1 min-h-0">
				{selectedPath ? (
					<ResizablePanelGroup orientation="horizontal">
						<ResizablePanel defaultSize="30%" minSize="22%" maxSize="50%">
							<TreeContent
								workspaceId={workspaceId}
								workspaceName={workspaceName}
								loading={loading}
								entries={entries}
								selectedPath={selectedPath}
								onSelect={handleSelect}
							/>
						</ResizablePanel>
						<ResizableHandle className="bg-transparent" />
						<ResizablePanel defaultSize="70%" minSize="30%">
							<div className="h-full border-l border-border/15">
								<FileViewer workspaceId={workspaceId} filePath={selectedPath} />
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				) : (
					<TreeContent
						workspaceId={workspaceId}
						workspaceName={workspaceName}
						loading={loading}
						entries={entries}
						selectedPath={selectedPath}
						onSelect={handleSelect}
					/>
				)}
			</div>

			<div className="flex items-center gap-0.5 px-1.5 py-1 border-t border-border/20 shrink-0">
				<button
					type="button"
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 h-6.5 rounded-md",
						"text-[11px] font-medium text-foreground/35",
						"hover:bg-foreground/5 hover:text-foreground/60",
						"active:bg-foreground/8 active:scale-[0.98]",
						"transition-all duration-75",
					)}
					onClick={() => {
						/* TODO: open file dialog */
					}}
				>
					<FolderOpenIcon className="size-3" />
					Open
				</button>
				<div className="w-px h-3 bg-border/30" />
				<button
					type="button"
					className={cn(
						"flex-1 flex items-center justify-center gap-1.5 h-6.5 rounded-md",
						"text-[11px] font-medium text-foreground/35",
						"hover:bg-foreground/5 hover:text-foreground/60",
						"active:bg-foreground/8 active:scale-[0.98]",
						"transition-all duration-75",
					)}
					onClick={() => {
						/* TODO: new file dialog */
					}}
				>
					<FilePlusIcon className="size-3" />
					New
				</button>
			</div>
		</div>
	);
}
