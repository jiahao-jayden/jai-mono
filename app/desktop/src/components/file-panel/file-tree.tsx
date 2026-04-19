import type { FileEntry } from "@jayden/jai-gateway";
import { ChevronRightIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { FileTypeIcon, FolderTypeIcon } from "./file-icon";

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

const INDENT_PX = 16;
const BASE_LEFT = 12;

function sortEntries(entries: FileEntry[]): FileEntry[] {
	return [...entries].sort((a, b) => {
		if (a.type === "directory" && b.type !== "directory") return -1;
		if (a.type !== "directory" && b.type === "directory") return 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
	});
}

const TreeNode = memo(function TreeNode({ entry, workspaceId, depth, selectedPath, onSelect }: TreeNodeProps) {
	const [expanded, setExpanded] = useState(false);
	const [children, setChildren] = useState<FileEntry[] | null>(entry.children ?? null);
	const [loading, setLoading] = useState(false);
	const isSelected = entry.path === selectedPath;
	const isDir = entry.type === "directory";
	const leftPad = depth * INDENT_PX + BASE_LEFT;

	const toggleExpand = useCallback(async () => {
		if (!isDir) return;
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
	}, [isDir, workspaceId, entry.path, expanded, children]);

	const handleClick = useCallback(() => {
		if (isDir) {
			toggleExpand();
		} else {
			onSelect(entry.path, entry.mimeType);
		}
	}, [isDir, entry.path, entry.mimeType, toggleExpand, onSelect]);

	const sortedChildren = useMemo(() => (children ? sortEntries(children) : null), [children]);

	return (
		<div>
			<button
				type="button"
				onClick={handleClick}
				className={cn(
					"group relative flex items-center w-full h-7 text-[13px] text-left",
					"transition-colors duration-75",
					"hover:bg-foreground/5",
					"active:bg-foreground/8",
					isSelected && [
						"bg-foreground/[0.07] text-foreground",
						"before:absolute before:left-0 before:top-1 before:bottom-1",
						"before:w-0.5 before:rounded-full before:bg-primary-2",
					],
					!isSelected && "text-foreground/60",
				)}
				style={{ paddingLeft: `${leftPad}px` }}
			>
				{/* Indent guides */}
				{depth > 0 &&
					Array.from({ length: depth }, (_, i) => {
						const key = `guide-${entry.path}-${i}`;
						return (
							<span
								key={key}
								className="absolute top-0 bottom-0 w-px bg-foreground/6 pointer-events-none"
								style={{ left: `${i * INDENT_PX + BASE_LEFT + 7}px` }}
							/>
						);
					})}

				{/* Chevron */}
				{isDir ? (
					<ChevronRightIcon
						className={cn(
							"size-3 shrink-0 mr-1 text-foreground/30",
							"transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
							expanded && "rotate-90 text-foreground/50",
						)}
					/>
				) : (
					<span className="w-4 shrink-0" />
				)}

				{/* Icon */}
				{isDir ? (
					<FolderTypeIcon folderName={entry.name} expanded={expanded} className="mr-1.5" />
				) : (
					<FileTypeIcon fileName={entry.name} className="mr-1.5" />
				)}

				{/* Name */}
				<span className={cn("truncate leading-none", isDir && "font-medium text-foreground/80")}>{entry.name}</span>

				{/* Loading spinner */}
				{loading && (
					<span className="ml-auto pr-2">
						<span className="inline-block size-2.5 rounded-full border border-foreground/15 border-t-foreground/50 animate-spin" />
					</span>
				)}
			</button>

			{/* Children */}
			{isDir && expanded && sortedChildren && (
				<div className="animate-in fade-in-0 slide-in-from-top-0.5 duration-100">
					{sortedChildren.map((child) => (
						<TreeNode
							key={child.path}
							entry={child}
							workspaceId={workspaceId}
							depth={depth + 1}
							selectedPath={selectedPath}
							onSelect={onSelect}
						/>
					))}
					{sortedChildren.length === 0 && (
						<div
							className="h-7 flex items-center text-[11px] text-foreground/20 italic"
							style={{ paddingLeft: `${(depth + 1) * INDENT_PX + BASE_LEFT + 20}px` }}
						>
							Empty folder
						</div>
					)}
				</div>
			)}
		</div>
	);
});

export function FileTree({ workspaceId, entries, selectedPath, onSelect }: FileTreeProps) {
	const sorted = useMemo(() => sortEntries(entries), [entries]);

	return (
		<div className="flex flex-col py-1 select-none">
			{sorted.map((entry) => (
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
