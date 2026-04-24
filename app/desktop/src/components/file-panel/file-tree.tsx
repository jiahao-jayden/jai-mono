import type {
	ContextMenuItem as FileTreeContextMenuItem,
	ContextMenuOpenContext as FileTreeContextMenuOpenContext,
	FileTreeDropResult,
	FileTreeRenameEvent,
	FileTree as PierreFileTreeModel,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree, useFileTreeSelector } from "@pierre/trees/react";
import { Copy, FilePlus2, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";

// Module-scoped so the reference is stable — Pierre's `useFileTreeSelector`
// invalidates its cache on selector/comparator identity change, which is
// what makes the built-in `useFileTreeSelection` loop under StrictMode.
function arraysShallowEqual(a: readonly string[], b: readonly string[]) {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function getSelectedPathsSnapshot(model: PierreFileTreeModel) {
	return model.getSelectedPaths();
}

interface FileTreeProps {
	workspaceId: string;
	initialPaths: readonly string[];
	selectedPath: string | null;
	onSelect: (path: string) => void;
	onError?: (message: string) => void;
}

type PendingKind = "file" | "directory";
type FileTreeModel = ReturnType<typeof useFileTree>["model"];

// Injected into Pierre's shadow root via `unsafeCSS`; selectors target
// Pierre's own data-attributes only.
const TREES_UNSAFE_CSS = /* css */ `
	[data-file-tree-search-container] {
		padding: 0.4375rem 0.5625rem 0.3125rem;
	}
	[data-file-tree-search-input] {
		border-radius: calc(var(--trees-border-radius) * 1.1);
		border: 1px solid transparent;
		padding: 0.3125rem 0.5625rem;
		font-size: 12.5px;
		letter-spacing: 0.002em;
		transition: border-color 160ms ease-out, background-color 160ms ease-out;
	}
	[data-file-tree-search-input]:focus,
	[data-file-tree-search-input]:focus-visible {
		outline: none;
		border-color: color-mix(in oklch, var(--primary-2) 42%, transparent);
		background: color-mix(in oklch, var(--foreground) 2.5%, transparent);
	}
	[data-file-tree-search-input]::placeholder {
		color: color-mix(in oklch, var(--foreground) 32%, var(--background));
		font-style: italic;
	}

	[data-type="item"] {
		padding-block: 3px;
		min-height: 26px;
	}
	[data-type="item"]:not([data-item-selected="true"]):not([data-item-drag-target="true"]):hover {
		background: color-mix(in oklch, var(--foreground) 4%, transparent);
	}

	[data-type="item"][data-item-selected="true"] {
		font-weight: 450;
		background: color-mix(in oklch, var(--foreground) 5%, transparent);
	}
	[data-type="item"][data-item-selected="true"] [data-item-section="icon"],
	[data-type="item"][data-item-selected="true"] [data-item-section="icon"] svg {
		color: color-mix(in oklch, var(--primary-2) 48%, var(--foreground));
	}

	[data-item-drag-target="true"] {
		background: color-mix(in oklch, var(--primary-2) 12%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--primary-2) 32%, transparent);
	}

	[data-file-tree-sticky-row="true"] {
		border-bottom: 1px solid color-mix(in oklch, var(--foreground) 6%, transparent);
		background: color-mix(in oklch, var(--background) 92%, var(--foreground));
		backdrop-filter: saturate(1.1);
	}

	[data-item-search-match="true"] mark {
		background: color-mix(in oklch, var(--primary-2) 28%, transparent);
		color: inherit;
		border-radius: 2px;
		padding: 0 1px;
	}

	[data-item-rename-input] {
		border-radius: calc(var(--trees-border-radius) * 0.85);
		border: 1px solid color-mix(in oklch, var(--primary-2) 50%, transparent);
		padding: 0.0625rem 0.375rem;
		background: var(--background);
		font-family: var(--trees-font-family);
		font-size: var(--trees-font-size);
		outline: none;
		transition: box-shadow 140ms ease-out, border-color 140ms ease-out;
	}
	[data-item-rename-input]:focus,
	[data-item-rename-input]:focus-visible {
		border-color: color-mix(in oklch, var(--primary-2) 68%, transparent);
		box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary-2) 16%, transparent);
	}

	[data-file-tree-virtualized-scroll]::-webkit-scrollbar {
		width: 6px;
		height: 6px;
	}
	[data-file-tree-virtualized-scroll]::-webkit-scrollbar-track {
		background: transparent;
	}
	[data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb {
		background: var(--trees-scrollbar-thumb);
		border-radius: 3px;
	}
	[data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb:hover {
		background: color-mix(in oklch, var(--foreground) 22%, transparent);
	}

	/* Force end-truncation: Pierre's hard-coded middle-truncate chops CJK
	 * filenames into uninformative stubs ("Next.js_…md"). Hiding the
	 * trailing priority-1 segment + marker lets the primary segment
	 * end-ellipsise naturally. Full name stays available via row a11y name. */
	[data-truncate-group-container='middle'] > [data-truncate-segment-priority='1'] {
		display: none;
	}
	[data-truncate-group-container='middle'] > [data-truncate-segment-priority='2']
		[data-truncate-marker-cell='true'] {
		display: none;
	}
`;

function stripTrailingSlash(p: string): string {
	return p.endsWith("/") ? p.slice(0, -1) : p;
}

function dirnameOf(path: string): string {
	const clean = stripTrailingSlash(path);
	const idx = clean.lastIndexOf("/");
	return idx < 0 ? "" : clean.slice(0, idx);
}

function joinPath(parent: string, name: string): string {
	return parent ? `${parent}/${name}` : name;
}

function uniqueName(base: string, existing: Set<string>, parent: string): string {
	if (!existing.has(joinPath(parent, base))) return base;
	for (let i = 2; i < 10_000; i++) {
		const candidate = `${base} ${i}`;
		if (!existing.has(joinPath(parent, candidate))) return candidate;
	}
	return `${base}-${Date.now()}`;
}

export function FileTree({ workspaceId, initialPaths, selectedPath, onSelect, onError }: FileTreeProps) {
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;

	const pendingCreatesRef = useRef<Map<string, PendingKind>>(new Map());
	const pathsSetRef = useRef<Set<string>>(new Set(initialPaths));
	const modelRef = useRef<FileTreeModel | null>(null);

	const handleRename = useCallback(
		async ({ sourcePath, destinationPath, isFolder }: FileTreeRenameEvent) => {
			const model = modelRef.current;
			if (!model) return;
			const sourceClean = stripTrailingSlash(sourcePath);
			const destClean = stripTrailingSlash(destinationPath);
			const sourceCanon = isFolder ? `${sourceClean}/` : sourceClean;
			const destCanon = isFolder ? `${destClean}/` : destClean;
			const pendingKind = pendingCreatesRef.current.get(sourceClean);
			const kind: PendingKind = pendingKind ?? (isFolder ? "directory" : "file");

			pathsSetRef.current.delete(sourceClean);
			pathsSetRef.current.add(destClean);

			if (pendingKind) {
				pendingCreatesRef.current.delete(sourceClean);
				try {
					await gateway.workspace.createPath(workspaceId, destClean, kind);
				} catch (err) {
					pathsSetRef.current.delete(destClean);
					model.remove(destCanon, { recursive: true });
					onErrorRef.current?.(`无法创建${kind === "directory" ? "文件夹" : "文件"}：${errorMessage(err)}`);
				}
				return;
			}

			try {
				await gateway.workspace.movePath(workspaceId, sourceClean, destClean);
			} catch (err) {
				pathsSetRef.current.delete(destClean);
				pathsSetRef.current.add(sourceClean);
				model.move(destCanon, sourceCanon);
				onErrorRef.current?.(`重命名失败：${errorMessage(err)}`);
			}
		},
		[workspaceId],
	);

	const handleDropComplete = useCallback(
		async (result: FileTreeDropResult) => {
			const model = modelRef.current;
			if (!model) return;
			const moves = buildMovesFromDrop(result);
			if (moves.length === 0) return;

			const failures: Array<{ from: string; to: string }> = [];

			for (const { from, to } of moves) {
				try {
					await gateway.workspace.movePath(workspaceId, stripTrailingSlash(from), stripTrailingSlash(to));
					pathsSetRef.current.delete(from);
					pathsSetRef.current.add(to);
				} catch {
					failures.push({ from, to });
				}
			}

			if (failures.length > 0) {
				model.batch(failures.map(({ from, to }) => ({ type: "move", from: to, to: from })));
				onErrorRef.current?.(
					failures.length === moves.length ? "移动失败" : `${moves.length} 项中有 ${failures.length} 项移动失败`,
				);
			}
		},
		[workspaceId],
	);

	const { model } = useFileTree({
		paths: initialPaths,
		density: "default",
		icons: { set: "complete", colored: false },
		stickyFolders: true,
		// Hide the search input for tiny lists — it's pure chrome cost at that size.
		search: initialPaths.length > 6,
		fileTreeSearchMode: "hide-non-matches",
		unsafeCSS: TREES_UNSAFE_CSS,
		renaming: { onRename: handleRename, onError: (msg) => onErrorRef.current?.(msg) },
		dragAndDrop: { onDropComplete: handleDropComplete, onDropError: (msg) => onErrorRef.current?.(msg) },
	});
	modelRef.current = model;

	// Use module-scoped selector/comparator (see top of file) to keep
	// `useFileTreeSelector` from thrashing its internal cache. This path
	// only handles keyboard-driven / programmatic selection changes;
	// mouse clicks go through the DOM bridge below.
	const selectedPaths = useFileTreeSelector(model, getSelectedPathsSnapshot, arraysShallowEqual);
	const lastNotifiedRef = useRef<string | null>(null);
	useEffect(() => {
		const path = selectedPaths[0];
		if (!path || path.endsWith("/")) return;
		if (path === lastNotifiedRef.current) return;
		lastNotifiedRef.current = path;
		onSelectRef.current(path);
	}, [selectedPaths]);

	useEffect(() => {
		if (!selectedPath) {
			lastNotifiedRef.current = null;
			return;
		}
		lastNotifiedRef.current = selectedPath;
		const item = model.getItem(selectedPath);
		if (item && !item.isSelected()) item.select();
	}, [model, selectedPath]);

	const startCreate = useCallback(
		(parentPath: string, kind: PendingKind) => {
			const defaultName = kind === "directory" ? "new-folder" : "new-file";
			const name = uniqueName(defaultName, pathsSetRef.current, parentPath);
			const newPath = joinPath(parentPath, name);
			const canonicalPath = kind === "directory" ? `${newPath}/` : newPath;

			pendingCreatesRef.current.set(newPath, kind);
			pathsSetRef.current.add(newPath);
			model.add(canonicalPath);

			if (!model.startRenaming(canonicalPath, { removeIfCanceled: true })) {
				pendingCreatesRef.current.delete(newPath);
				pathsSetRef.current.delete(newPath);
				model.remove(canonicalPath, { recursive: true });
			}
		},
		[model],
	);

	const handleDelete = useCallback(
		async (path: string, isFolder: boolean) => {
			const clean = stripTrailingSlash(path);
			try {
				await gateway.workspace.deletePath(workspaceId, clean);
				pathsSetRef.current.delete(clean);
				if (isFolder) {
					for (const p of Array.from(pathsSetRef.current)) {
						if (p.startsWith(`${clean}/`)) pathsSetRef.current.delete(p);
					}
				}
				model.remove(path, { recursive: true });
			} catch (err) {
				onErrorRef.current?.(`删除失败：${errorMessage(err)}`);
			}
		},
		[workspaceId, model],
	);

	const renderContextMenu = useCallback(
		(item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => {
			const isFolder = item.kind === "directory";
			const targetDir = isFolder ? stripTrailingSlash(item.path) : dirnameOf(item.path);

			return (
				<ContextMenu
					isFolder={isFolder}
					onRename={() => {
						context.close({ restoreFocus: false });
						model.startRenaming(item.path);
					}}
					onDelete={() => {
						context.close();
						void handleDelete(item.path, isFolder);
					}}
					onCopyPath={() => {
						context.close();
						void navigator.clipboard.writeText(stripTrailingSlash(item.path));
					}}
					onNewFile={
						isFolder
							? () => {
									context.close({ restoreFocus: false });
									startCreate(targetDir, "file");
								}
							: undefined
					}
					onNewFolder={
						isFolder
							? () => {
									context.close({ restoreFocus: false });
									startCreate(targetDir, "directory");
								}
							: undefined
					}
				/>
			);
		},
		[model, handleDelete, startCreate],
	);

	const memoizedRenderMenu = useMemo(() => renderContextMenu, [renderContextMenu]);

	// Pierre's inner React-18 root lives in shadow DOM, and its synthetic
	// `onClick` doesn't fire reliably here. Bridge via native click +
	// composedPath, then drive Pierre's own select/toggle API.
	const hostRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const onClick = (e: MouseEvent) => {
			if (e.defaultPrevented) return;
			if (e.button !== 0) return;
			const composed = (e as MouseEvent & { composedPath?: () => EventTarget[] }).composedPath?.() ?? [];
			const hitsInteractive = composed.some(
				(el) =>
					el instanceof Element &&
					(el.hasAttribute?.("data-file-tree-search-input") ||
						el.hasAttribute?.("data-file-tree-rename-input") ||
						el.getAttribute?.("data-item-section") === "context-menu-trigger"),
			);
			if (hitsInteractive) return;

			const itemEl = composed.find(
				(el): el is Element => el instanceof Element && el.getAttribute?.("data-type") === "item",
			);
			const path = itemEl?.getAttribute("data-item-path");
			if (!path) return;

			const item = modelRef.current?.getItem(path);
			if (!item) return;

			// Pierre's runtime handle exposes these members but the exported type doesn't.
			const handle = item as unknown as {
				isDirectory?: () => boolean;
				toggle?: () => void;
				select?: () => void;
				isSelected?: () => boolean;
			};
			if (handle.isDirectory?.()) {
				handle.toggle?.();
				return;
			}

			if (handle.isSelected?.() !== true) handle.select?.();
			onSelectRef.current(path);
		};
		host.addEventListener("click", onClick);
		return () => {
			host.removeEventListener("click", onClick);
		};
	}, []);

	return (
		<div ref={hostRef} className="h-full w-full">
			<PierreFileTree model={model} renderContextMenu={memoizedRenderMenu} className="h-full w-full" />
		</div>
	);
}

function buildMovesFromDrop(result: FileTreeDropResult): Array<{ from: string; to: string }> {
	const targetDir = result.target.directoryPath ? stripTrailingSlash(result.target.directoryPath) : "";
	const moves: Array<{ from: string; to: string }> = [];
	for (const from of result.draggedPaths) {
		const clean = stripTrailingSlash(from);
		const name = clean.slice(clean.lastIndexOf("/") + 1);
		const to = joinPath(targetDir, name);
		if (clean === to) continue;
		const isDir = from.endsWith("/");
		moves.push({ from, to: isDir ? `${to}/` : to });
	}
	return moves;
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return "unknown error";
}

interface ContextMenuProps {
	isFolder: boolean;
	onRename: () => void;
	onDelete: () => void;
	onCopyPath: () => void;
	onNewFile?: () => void;
	onNewFolder?: () => void;
}

const MENU_EDGE_GUTTER = 8;

// Pierre anchors the menu at event coordinates with `position: fixed` and
// never flips. Measure on layout and translate back into the viewport.
function ContextMenu({ isFolder, onRename, onDelete, onCopyPath, onNewFile, onNewFolder }: ContextMenuProps) {
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.transform = "";
		const rect = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const overflowRight = rect.right + MENU_EDGE_GUTTER - vw;
		const overflowBottom = rect.bottom + MENU_EDGE_GUTTER - vh;
		const dx = overflowRight > 0 ? -Math.min(overflowRight, rect.width) : 0;
		const dy = overflowBottom > 0 ? -Math.min(overflowBottom, rect.height) : 0;
		if (dx !== 0 || dy !== 0) {
			el.style.transform = `translate(${dx}px, ${dy}px)`;
		}
	});

	return (
		<div
			ref={ref}
			role="menu"
			className={cn(
				"min-w-44 overflow-hidden select-none",
				"rounded-xl border border-border/40 bg-popover p-1 text-popover-foreground",
				"shadow-[0_1px_2px_-1px_rgba(20,22,18,0.06),0_12px_32px_-12px_rgba(20,22,18,0.18),0_4px_10px_-6px_rgba(20,22,18,0.08)]",
				"dark:shadow-[0_1px_2px_-1px_rgba(0,0,0,0.35),0_14px_34px_-10px_rgba(0,0,0,0.55),0_4px_10px_-4px_rgba(0,0,0,0.35)]",
			)}
		>
			{isFolder && onNewFile && (
				<MenuItem
					icon={<FilePlus2 className="size-3.5" strokeWidth={1.5} />}
					label="新建文件"
					onClick={onNewFile}
				/>
			)}
			{isFolder && onNewFolder && (
				<MenuItem
					icon={<FolderPlus className="size-3.5" strokeWidth={1.5} />}
					label="新建文件夹"
					onClick={onNewFolder}
				/>
			)}
			{isFolder && <Separator />}
			<MenuItem icon={<Pencil className="size-3.5" strokeWidth={1.5} />} label="重命名" onClick={onRename} />
			<MenuItem icon={<Copy className="size-3.5" strokeWidth={1.5} />} label="复制路径" onClick={onCopyPath} />
			<Separator />
			<MenuItem
				icon={<Trash2 className="size-3.5" strokeWidth={1.5} />}
				label="删除"
				onClick={onDelete}
				tone="danger"
			/>
		</div>
	);
}

interface MenuItemProps {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	tone?: "default" | "danger";
}

// Mirror tokens from `ui/dropdown-menu.tsx` — Pierre renders its context
// menu through a slot so the Radix primitive can't be reused.
function MenuItem({ icon, label, onClick, tone = "default" }: MenuItemProps) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			className={cn(
				"group flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left",
				"text-[13px] leading-none outline-hidden select-none",
				"transition-colors duration-100 ease-out",
				tone === "danger"
					? "text-destructive/85 hover:bg-destructive/8 hover:text-destructive focus-visible:bg-destructive/8 focus-visible:text-destructive"
					: "text-foreground/80 hover:bg-foreground/5 hover:text-foreground focus-visible:bg-foreground/5 focus-visible:text-foreground",
			)}
		>
			<span
				className={cn(
					"shrink-0 transition-colors duration-100",
					tone === "danger"
						? "text-destructive/55 group-hover:text-destructive"
						: "text-foreground/40 group-hover:text-foreground/70",
				)}
			>
				{icon}
			</span>
			<span className="flex-1 truncate">{label}</span>
		</button>
	);
}

function Separator() {
	return <div className="-mx-1 my-1 h-px bg-border/40" />;
}
