import type { FileEntry } from "@jayden/jai-gateway";
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";

interface FileTreeProps {
	workspaceId: string;
	entries: FileEntry[];
	selectedPath: string | null;
	onSelect: (path: string, mimeType?: string) => void;
}

interface TreeNodeProps {
	entry: FileEntry;
	workspaceId: string;
	depth: number;
	selectedPath: string | null;
	onSelect: (path: string, mimeType?: string) => void;
}

function TreeNode({ entry, workspaceId, depth, selectedPath, onSelect }: TreeNodeProps) {
	const [expanded, setExpanded] = useState(false);
	const [children, setChildren] = useState<FileEntry[] | null>(entry.children ?? null);
	const [loading, setLoading] = useState(false);
	const isSelected = entry.path === selectedPath;

	const toggleExpand = useCallback(async () => {
		if (entry.type !== "directory") return;

		if (!expanded && children === null) {
			setLoading(true);
			try {
				const res = await gateway.workspace.listFiles(workspaceId, entry.path, 1);
				setChildren(res.entries);
			} catch (err) {
				console.error("[file-tree] load failed:", err);
				setChildren([]);
			}
			setLoading(false);
		}
		setExpanded((v) => !v);
	}, [entry, workspaceId, expanded, children]);

	const handleClick = useCallback(() => {
		if (entry.type === "directory") {
			toggleExpand();
		} else {
			onSelect(entry.path, entry.mimeType);
		}
	}, [entry, toggleExpand, onSelect]);

	return (
		<div>
			<button
				type="button"
				onClick={handleClick}
				className={cn(
					"flex items-center gap-1 w-full py-1 px-1.5 rounded-sm text-[13px] text-left transition-colors",
					"hover:bg-muted/60",
					isSelected && "bg-muted text-foreground",
					!isSelected && "text-foreground/70",
				)}
				style={{ paddingLeft: `${depth * 12 + 6}px` }}
			>
				{entry.type === "directory" ? (
					<ChevronRightIcon
						className={cn(
							"size-3 shrink-0 transition-transform duration-150",
							expanded && "rotate-90",
						)}
					/>
				) : (
					<span className="size-3 shrink-0" />
				)}
				{entry.type === "directory" ? (
					expanded ? (
						<FolderOpenIcon className="size-3.5 shrink-0 text-amber-500/80" />
					) : (
						<FolderIcon className="size-3.5 shrink-0 text-amber-500/80" />
					)
				) : (
					<FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
				)}
				<span className="truncate">{entry.name}</span>
				{loading && <span className="ml-auto text-[10px] text-muted-foreground/40">...</span>}
			</button>

			{entry.type === "directory" && expanded && children && (
				<div>
					{children.map((child) => (
						<TreeNode
							key={child.path}
							entry={child}
							workspaceId={workspaceId}
							depth={depth + 1}
							selectedPath={selectedPath}
							onSelect={onSelect}
						/>
					))}
					{children.length === 0 && (
						<div
							className="text-[11px] text-muted-foreground/40 py-1"
							style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}
						>
							Empty
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function FileTree({ workspaceId, entries, selectedPath, onSelect }: FileTreeProps) {
	return (
		<div className="flex flex-col py-1">
			{entries.map((entry) => (
				<TreeNode
					key={entry.path}
					entry={entry}
					workspaceId={workspaceId}
					depth={0}
					selectedPath={selectedPath}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}
