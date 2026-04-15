import type { FileEntry } from "@jayden/jai-gateway";
import { FolderIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useFilePanelStore } from "@/stores/file-panel";
import { FileTree } from "./file-tree";
import { FileViewer } from "./file-viewer";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

export function FilePanel() {
	const { workspaceId, selectedPath, openFile, closeFile, setOpen } = useFilePanelStore();
	const [entries, setEntries] = useState<FileEntry[]>([]);
	const [loading, setLoading] = useState(true);

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
			openFile(path);
		},
		[openFile],
	);

	const handleClose = useCallback(() => {
		setOpen(false);
	}, [setOpen]);

	if (!workspaceId) return null;

	return (
		<div className="flex flex-col h-full border-l border-border/50 bg-background">
			{/* Drag region for macOS titlebar */}
			<div className="h-3 shrink-0" style={drag} />

			{/* Panel header */}
			<div className="flex items-center justify-between px-3 py-1.5 shrink-0">
				<div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/70">
					<FolderIcon className="size-3.5" />
					<span>Workspace</span>
				</div>
				<button
					type="button"
					onClick={handleClose}
					className="p-0.5 rounded-sm hover:bg-muted transition-colors text-muted-foreground/50 hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>

			{/* Content: tree + optional viewer */}
			<div className="flex-1 flex flex-col min-h-0">
				{/* File tree */}
				<div
					className={cn(
						"overflow-auto px-1",
						selectedPath ? "h-[40%] shrink-0 border-b border-border/50" : "flex-1",
					)}
				>
					{loading ? (
						<div className="p-3 text-[12px] text-muted-foreground/40">Loading files...</div>
					) : entries.length === 0 ? (
						<div className="p-3 text-[12px] text-muted-foreground/40">No files in workspace</div>
					) : (
						<FileTree
							workspaceId={workspaceId}
							entries={entries}
							selectedPath={selectedPath}
							onSelect={handleSelect}
						/>
					)}
				</div>

				{/* File viewer */}
				{selectedPath && (
					<div className="flex-1 min-h-0">
						<FileViewer workspaceId={workspaceId} filePath={selectedPath} onClose={closeFile} />
					</div>
				)}
			</div>
		</div>
	);
}
