import type { FileTree, FileTreeDirectoryHandle, FileTreeItemHandle } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/ui/chat-message";
import { Input } from "@/components/ui/input";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type {
	DesktopArtifact,
	DesktopArtifactPreview,
	DesktopWorkspaceEntry,
	DesktopWorkspaceFile,
} from "../../../shared/desktop-rpc";

interface WorkspacePanelProps {
	readonly sessionId: string;
	readonly openFilePath?: string | null;
}

const NEW_WORKSPACE_TAB_PATH = "__workspace_new_tab__";

function treePathForEntry(entry: DesktopWorkspaceEntry): string {
	return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function workspacePathForTreePath(treePath: string): string {
	return treePath.endsWith("/") ? treePath.slice(0, -1) : treePath;
}

function asDirectoryHandle(item: FileTreeItemHandle | null): FileTreeDirectoryHandle | null {
	return item?.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
}

interface WorkspaceTab extends DesktopWorkspaceFile {
	readonly name: string;
	readonly state: "empty" | "loading" | "ready" | "error";
}

export function WorkspacePanel({ sessionId, openFilePath }: WorkspacePanelProps) {
	const icons = useIcons();
	const FolderIcon = icons.folder;
	const FolderOpenIcon = icons["folder-open"];
	const FileIcon = icons["file-code"];
	const SearchIcon = icons.search;
	const PlusIcon = icons.plus;
	const XIcon = icons.x;
	const LoadingIcon = icons.loader;
	const PanelRightIcon = icons["panel-right"];
	const reducedMotion = useReducedMotion();
	const [entriesByPath, setEntriesByPath] = useState<Record<string, readonly DesktopWorkspaceEntry[]>>({});
	const [loadingPaths, setLoadingPaths] = useState<ReadonlySet<string>>(new Set());
	const [rootLoaded, setRootLoaded] = useState(false);
	const [treeCollapsed, setTreeCollapsed] = useState(false);
	const [tabs, setTabs] = useState<readonly WorkspaceTab[]>([
		{ path: NEW_WORKSPACE_TAB_PATH, name: "打开文件", content: "", state: "empty" },
	]);
	const tabsRef = useRef<readonly WorkspaceTab[]>([]);
	const [activePath, setActivePath] = useState<string | null>(NEW_WORKSPACE_TAB_PATH);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const treeModelRef = useRef<FileTree | null>(null);
	const treePathsRef = useRef(new Set<string>());
	const directoryPathsRef = useRef(new Set<string>());
	const loadedDirectoriesRef = useRef(new Set<string>());
	const directoryLoadsRef = useRef(new Map<string, Promise<void>>());
	const openFileRef = useRef<(filePath: string) => Promise<void>>(async () => undefined);
	const selectionSyncRef = useRef(false);

	const loadDirectory = useCallback(
		async (directoryPath: string) => {
			if (loadedDirectoriesRef.current.has(directoryPath)) return;
			const activeLoad = directoryLoadsRef.current.get(directoryPath);
			if (activeLoad) return activeLoad;

			const load = (async () => {
				setLoadingPaths((current) => new Set([...current, directoryPath]));
				try {
					const result = await desktop.workspace.list({ sessionId, path: directoryPath });
					loadedDirectoriesRef.current.add(directoryPath);
					setEntriesByPath((current) => ({ ...current, [directoryPath]: result.entries }));
					if (directoryPath === "") setRootLoaded(true);
					for (const entry of result.entries) {
						if (entry.kind === "directory") directoryPathsRef.current.add(entry.path);
					}
					setError(null);
				} catch {
					setError(directoryPath ? "无法读取这个目录" : "无法读取工作区目录");
				} finally {
					setLoadingPaths((current) => {
						const next = new Set(current);
						next.delete(directoryPath);
						return next;
					});
				}
			})();
			directoryLoadsRef.current.set(directoryPath, load);
			try {
				await load;
			} finally {
				if (directoryLoadsRef.current.get(directoryPath) === load) {
					directoryLoadsRef.current.delete(directoryPath);
				}
			}
		},
		[sessionId],
	);

	const ensureFilePathInTree = useCallback(
		async (filePath: string) => {
			const segments = filePath.split("/").filter(Boolean);
			let directoryPath = "";
			for (const segment of segments.slice(0, -1)) {
				await loadDirectory(directoryPath);
				const parent = directoryPath ? (treeModelRef.current?.getItem(`${directoryPath}/`) ?? null) : null;
				asDirectoryHandle(parent)?.expand();
				directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment;
			}
			await loadDirectory(directoryPath);
			const directory = directoryPath ? (treeModelRef.current?.getItem(`${directoryPath}/`) ?? null) : null;
			asDirectoryHandle(directory)?.expand();
		},
		[loadDirectory],
	);

	useEffect(() => {
		tabsRef.current = tabs;
	}, [tabs]);

	const openFile = useCallback(
		async (filePath: string) => {
			const existing = tabsRef.current.find((tab) => tab.path === filePath);
			setActivePath(filePath);
			if (existing && existing.state !== "error") return;

			const name = filePath.split("/").at(-1) ?? filePath;
			setTabs((current) => {
				const index = current.findIndex((tab) => tab.path === filePath);
				if (index === -1) {
					const placeholderIndex = current.findIndex((tab) => tab.path === NEW_WORKSPACE_TAB_PATH);
					if (placeholderIndex === -1)
						return [...current, { path: filePath, name, content: "", state: "loading" }];
					const next = [...current];
					next[placeholderIndex] = { path: filePath, name, content: "", state: "loading" };
					return next;
				}
				const next = [...current];
				next[index] = { ...next[index], state: "loading" };
				return next;
			});
			try {
				await ensureFilePathInTree(filePath);
				const file = await desktop.workspace.read({ sessionId, path: filePath });
				setTabs((current) =>
					current.map((tab) => (tab.path === filePath ? { ...tab, ...file, state: "ready" } : tab)),
				);
				const selectedItem = treeModelRef.current?.getItem(filePath);
				if (selectedItem && !selectedItem.isSelected()) {
					selectionSyncRef.current = true;
					selectedItem.select();
				}
				setError(null);
			} catch {
				setTabs((current) => current.map((tab) => (tab.path === filePath ? { ...tab, state: "error" } : tab)));
				setError("无法读取文件");
			}
		},
		[ensureFilePathInTree, sessionId],
	);
	openFileRef.current = openFile;

	const { model: treeModel } = useFileTree({
		paths: [],
		initialExpansion: "closed",
		fileTreeSearchMode: "hide-non-matches",
		search: false,
		density: "compact",
		onSelectionChange: (selectedPaths) => {
			if (selectionSyncRef.current) {
				selectionSyncRef.current = false;
				return;
			}
			const selectedPath = selectedPaths.at(-1);
			if (!selectedPath || selectedPath.endsWith("/")) return;
			void openFileRef.current(workspacePathForTreePath(selectedPath));
		},
	});
	treeModelRef.current = treeModel;

	useEffect(() => {
		for (const entries of Object.values(entriesByPath)) {
			for (const entry of entries) {
				const treePath = treePathForEntry(entry);
				if (treePathsRef.current.has(treePath)) continue;
				treePathsRef.current.add(treePath);
				treeModel.add(treePath);
			}
		}
	}, [entriesByPath, treeModel]);

	useEffect(() => {
		void loadDirectory("");
	}, [loadDirectory]);

	useEffect(() => {
		const unsubscribe = treeModel.subscribe(() => {
			for (const directoryPath of directoryPathsRef.current) {
				const item = asDirectoryHandle(treeModel.getItem(`${directoryPath}/`));
				if (item?.isExpanded() && !loadedDirectoriesRef.current.has(directoryPath)) {
					void loadDirectory(directoryPath);
				}
			}
		});
		return unsubscribe;
	}, [loadDirectory, treeModel]);

	useEffect(() => {
		treeModel.setSearch(query.trim() || null);
	}, [query, treeModel]);

	useEffect(() => {
		if (openFilePath) void openFile(openFilePath);
	}, [openFile, openFilePath]);

	const closeTab = (filePath: string) => {
		setTabs((current) => {
			const index = current.findIndex((tab) => tab.path === filePath);
			const next = current.filter((tab) => tab.path !== filePath);
			if (next.length === 0) {
				next.push({ path: NEW_WORKSPACE_TAB_PATH, name: "打开文件", content: "", state: "empty" });
			}
			if (activePath === filePath) {
				const nextTab = next[index] ?? next[index - 1] ?? null;
				setActivePath(nextTab?.path ?? null);
			}
			return next;
		});
	};

	const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
	const activeContent = activeTab?.state === "ready" ? activeTab.content : null;
	const newTabExists = tabs.some((tab) => tab.path === NEW_WORKSPACE_TAB_PATH);
	const previewInitial = reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" };
	const treeLoading = loadingPaths.size > 0;
	const activePreviewPath = activeTab?.path === NEW_WORKSPACE_TAB_PATH ? "/" : (activeTab?.path ?? "/");
	const treeHostStyle = {
		"--trees-bg-override": "color-mix(in oklch, var(--muted) 14%, var(--background))",
		"--trees-selected-bg-override":
			"color-mix(in oklch, var(--foreground) 11%, color-mix(in oklch, var(--muted) 14%, var(--background)))",
	} as CSSProperties;
	return (
		<aside
			id="workspace-panel"
			aria-label="Workspace files"
			className="flex h-full w-full min-w-0 flex-col bg-background"
		>
			<div
				className="flex h-13 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/45 px-2.5"
				role="tablist"
				aria-label="打开的文件"
			>
				{tabs.map((tab) => {
					const isActive = tab.path === activePath;
					const tabClassName = cn(
						"h-8 min-w-0 max-w-44 shrink-0 rounded-[9px] px-2.5 text-[12.5px]",
						isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
					);
					return (
						<div key={tab.path} className="flex shrink-0 items-center rounded-[9px]">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								role="tab"
								aria-selected={isActive}
								onClick={() => setActivePath(tab.path)}
								className={tabClassName}
								contentClassName="min-w-0"
								labelClassName="flex min-w-0 items-center gap-1.5"
							>
								<FileIcon size={14} className="shrink-0" />
								<span className="truncate">{tab.name}</span>
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`关闭 ${tab.name}`}
								title={`关闭 ${tab.name}`}
								onClick={() => closeTab(tab.path)}
								className="-ml-1 size-6 shrink-0 text-muted-foreground hover:text-foreground"
							>
								<XIcon size={12} />
							</Button>
						</div>
					);
				})}
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="新建文件标签"
					title="新建文件标签"
					onClick={() => {
						if (!newTabExists) {
							setTabs((current) => [
								...current,
								{ path: NEW_WORKSPACE_TAB_PATH, name: "打开文件", content: "", state: "empty" },
							]);
						}
						setActivePath(NEW_WORKSPACE_TAB_PATH);
					}}
					className="shrink-0 text-muted-foreground"
				>
					<PlusIcon size={15} />
				</Button>
				<div className="ml-auto shrink-0 border-l border-border/45 pl-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={treeCollapsed ? "展开文件树" : "收起文件树"}
						title={treeCollapsed ? "展开文件树" : "收起文件树"}
						aria-pressed={!treeCollapsed}
						onClick={() => setTreeCollapsed((current) => !current)}
						className="text-muted-foreground"
					>
						<PanelRightIcon size={15} className={cn({ "rotate-180": treeCollapsed })} />
					</Button>
				</div>
			</div>

			<div
				className={cn(
					"grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-out",
					treeCollapsed ? "grid-cols-[minmax(0,1fr)_0fr]" : "grid-cols-[minmax(0,1fr)_minmax(11rem,42%)]",
				)}
			>
				<section className="flex min-h-0 min-w-0 flex-col">
					<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/45 px-3 text-[12px] text-muted-foreground">
						<FolderOpenIcon size={14} className="shrink-0" />
						<span className="truncate">{activePreviewPath}</span>
					</div>
					{activeTab ? (
						<AnimatePresence mode="wait" initial={false}>
							<motion.div
								key={`${activeTab.path}:${activeTab.state}`}
								initial={previewInitial}
								animate={{ opacity: 1, transform: "translateY(0)" }}
								transition={{ duration: reducedMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
								className="min-h-0 min-w-0 flex-1 overflow-y-auto"
							>
								{activeTab.state === "empty" ? (
									<div className="flex h-full min-h-72 flex-col items-center justify-center px-5 py-10 text-center">
										<FolderIcon size={24} className="text-muted-foreground" />
										<h2 className="mt-3 text-[14px] font-semibold">打开文件</h2>
										<p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
											从工作区目录树中选择文件
										</p>
									</div>
								) : activeTab.state === "loading" ? (
									<div className="flex h-full min-h-72 items-center justify-center gap-2 text-[12px] text-muted-foreground">
										<LoadingIcon size={16} className="animate-spin" />
										读取文件…
									</div>
								) : activeTab.state === "error" ? (
									<div className="flex h-full min-h-72 flex-col items-center justify-center px-5 text-center">
										<FileIcon size={22} className="text-muted-foreground" />
										<p className="mt-3 text-[13px] font-semibold">文件不可用</p>
										<p className="mt-1 text-[12px] text-muted-foreground">{error ?? "无法读取这个文件。"}</p>
									</div>
								) : activeContent !== null ? (
									<FilePreview path={activeTab.path} content={activeContent} />
								) : null}
							</motion.div>
						</AnimatePresence>
					) : (
						<div className="flex min-h-72 flex-1 flex-col items-center justify-center px-5 py-10 text-center">
							<FolderIcon size={24} className="text-muted-foreground" />
							<h2 className="mt-3 text-[14px] font-semibold">打开文件</h2>
							<p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">从工作区目录树中选择文件</p>
						</div>
					)}
				</section>

				<section
					className={cn(
						"flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border/45 bg-muted/[0.14]",
						treeCollapsed && "pointer-events-none opacity-0",
					)}
					aria-hidden={treeCollapsed}
					inert={treeCollapsed}
				>
					<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/45 px-3">
						<FolderOpenIcon size={14} className="shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">文件树</span>
						{treeLoading ? (
							<LoadingIcon size={13} className="shrink-0 animate-spin text-muted-foreground" />
						) : null}
					</div>
					<div className="shrink-0 p-2.5 pb-2">
						<div className="relative">
							<SearchIcon
								size={15}
								className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="筛选文件…"
								aria-label="筛选工作区文件"
								density="compact"
								className="h-8 pl-8"
							/>
						</div>
					</div>
					<div className="min-h-0 min-w-0 flex-1 overflow-hidden px-1.5 pb-2.5">
						{rootLoaded ? (
							<PierreFileTree
								model={treeModel}
								className="pierre-trees-host"
								style={treeHostStyle}
								aria-label="工作区文件树"
							/>
						) : (
							<div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground">
								{treeLoading ? <LoadingIcon size={14} className="animate-spin" /> : null}
								{error ?? "读取工作区…"}
							</div>
						)}
					</div>
				</section>
			</div>
		</aside>
	);
}

function FilePreview({ path, content }: { readonly path: string; readonly content: string }) {
	const extension = path.split(".").at(-1)?.toLowerCase();
	if (extension === "md" || extension === "markdown") {
		return (
			<div className="px-4 py-4">
				<MarkdownContent content={content} className="text-[12.5px] leading-5" />
			</div>
		);
	}
	return (
		<pre className="m-0 whitespace-pre-wrap break-words px-4 py-4 font-mono text-[11.5px] leading-5 text-foreground/85">
			{content}
		</pre>
	);
}

interface ArtifactPanelProps {
	readonly sessionId: string;
	readonly artifacts: readonly DesktopArtifact[];
	readonly selectedArtifactId: string | null;
	onSelectArtifact(artifact: DesktopArtifact): void;
}

export function ArtifactPanel({ sessionId, artifacts, selectedArtifactId, onSelectArtifact }: ArtifactPanelProps) {
	const icons = useIcons();
	const ArchiveIcon = icons.archive;
	const FileCodeIcon = icons["file-code"];
	const HtmlIcon = icons["rectangle-horizontal"];
	const LoadingIcon = icons.loader;
	const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
	const [preview, setPreview] = useState<DesktopArtifactPreview | null>(null);
	const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");

	useEffect(() => {
		let cancelled = false;
		if (!selectedArtifact) {
			setPreview(null);
			setPreviewState("idle");
			return;
		}

		setPreview(null);
		setPreviewState("loading");
		void desktop.artifact
			.read({ sessionId, artifactId: selectedArtifact.id })
			.then((result) => {
				if (cancelled) return;
				setPreview(result);
				setPreviewState("idle");
			})
			.catch(() => {
				if (cancelled) return;
				setPreviewState("error");
			});

		return () => {
			cancelled = true;
		};
	}, [selectedArtifact, sessionId]);

	return (
		<aside
			id="artifact-panel"
			aria-label="Artifact preview"
			className="h-full w-full min-w-0 overflow-y-auto bg-background py-3 pr-3"
		>
			<div className="flex min-h-full flex-col overflow-hidden rounded-[14px] border border-border bg-card">
				<div className="flex h-13 shrink-0 items-center gap-2 border-b border-border/45 px-4">
					<ArchiveIcon size={16} className="text-muted-foreground" />
					<h2 className="min-w-0 flex-1 text-[14px] font-semibold">Artifacts</h2>
					<span className="text-[12px] tabular-nums text-muted-foreground">{artifacts.length}</span>
				</div>

				{artifacts.length === 0 ? (
					<ArtifactEmptyState icon={ArchiveIcon} />
				) : (
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="max-h-56 shrink-0 overflow-y-auto border-b border-border/45 p-2">
							<ul className="space-y-1" aria-label="Session artifacts">
								{artifacts.map((artifact) => {
									const isSelected = artifact.id === selectedArtifact?.id;
									const ArtifactIcon = artifact.format === "html" ? HtmlIcon : FileCodeIcon;
									return (
										<li key={artifact.id}>
											<Button
												type="button"
												variant="ghost"
												size="md"
												active={isSelected}
												onClick={() => onSelectArtifact(artifact)}
												aria-current={isSelected ? "true" : undefined}
												className="h-auto w-full justify-start rounded-[8px] px-2 py-1.5"
												contentClassName="w-full min-w-0 justify-start"
												labelClassName="flex min-w-0 flex-1 items-center gap-2"
											>
												<ArtifactIcon size={15} className="shrink-0 text-muted-foreground" />
												<span className="min-w-0 flex-1 text-left">
													<span
														className="block truncate text-[12.5px] font-medium text-foreground"
														title={artifact.path}
													>
														{artifactName(artifact.path)}
													</span>
													<span
														className="mt-0.5 block truncate text-[11px] text-muted-foreground"
														title={artifact.path}
													>
														{artifact.path}
													</span>
												</span>
												<span className="shrink-0 text-[10.5px] font-medium uppercase text-muted-foreground">
													{artifact.format}
												</span>
											</Button>
										</li>
									);
								})}
							</ul>
						</div>
						<ArtifactPreview
							artifact={selectedArtifact}
							preview={preview}
							previewState={previewState}
							loadingIcon={LoadingIcon}
							fileIcon={FileCodeIcon}
						/>
					</div>
				)}
			</div>
		</aside>
	);
}

function ArtifactEmptyState({ icon: ArchiveIcon }: { readonly icon: ReturnType<typeof useIcons>["archive"] }) {
	return (
		<div className="flex min-h-90 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
			<span aria-hidden="true" className="flex size-10 items-center justify-center text-muted-foreground">
				<ArchiveIcon size={22} />
			</span>
			<h3 className="mt-3 text-[13px] font-semibold">No artifacts yet</h3>
			<p className="mt-2 max-w-56 text-[12px] leading-5 text-foreground/65">
				生成的 Markdown 和 HTML 会显示在这里。
			</p>
		</div>
	);
}

function ArtifactPreview({
	artifact,
	preview,
	previewState,
	loadingIcon: LoadingIcon,
	fileIcon: FileCodeIcon,
}: {
	readonly artifact: DesktopArtifact | null;
	readonly preview: DesktopArtifactPreview | null;
	readonly previewState: "idle" | "loading" | "error";
	readonly loadingIcon: ReturnType<typeof useIcons>["loader"];
	readonly fileIcon: ReturnType<typeof useIcons>["file-code"];
}) {
	if (!artifact) {
		return (
			<div className="flex min-h-72 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
				<FileCodeIcon size={22} className="text-muted-foreground" />
				<h3 className="mt-3 text-[13px] font-semibold">Select an artifact</h3>
				<p className="mt-2 max-w-56 text-[12px] leading-5 text-foreground/65">选择一个文件以查看预览。</p>
			</div>
		);
	}

	if (previewState === "loading" || (previewState === "idle" && !preview)) {
		return (
			<div className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-[12px] text-foreground/65">
				<LoadingIcon size={18} className="animate-spin text-muted-foreground" />
				Loading preview
			</div>
		);
	}

	if (previewState === "error" || !preview) {
		return (
			<div className="flex min-h-72 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
				<FileCodeIcon size={22} className="text-muted-foreground" />
				<h3 className="mt-3 text-[13px] font-semibold">Preview unavailable</h3>
				<p className="mt-2 max-w-56 text-[12px] leading-5 text-foreground/65">
					文件不再可用，或当前项目没有访问权限。
				</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/45 px-3 text-[12px] text-foreground/65">
				<FileCodeIcon size={14} className="shrink-0" />
				<span className="min-w-0 flex-1 truncate" title={artifact.path}>
					{artifact.path}
				</span>
			</div>
			{artifact.format === "markdown" ? (
				<div className="min-h-72 flex-1 overflow-y-auto px-4 py-4">
					<MarkdownContent content={preview.content} className="text-[13px] leading-6" />
				</div>
			) : (
				<iframe
					title={artifactName(artifact.path)}
					sandbox=""
					referrerPolicy="no-referrer"
					srcDoc={sandboxHtml(preview.content)}
					className="min-h-72 flex-1 border-0 bg-white"
				/>
			)}
		</div>
	);
}

function artifactName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function sandboxHtml(content: string): string {
	const policy = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
	const csp = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
	const headStart = content.match(/<head\b[^>]*>/i);
	if (headStart?.index !== undefined) {
		const insertionIndex = headStart.index + headStart[0].length;
		return `${content.slice(0, insertionIndex)}${csp}${content.slice(insertionIndex)}`;
	}
	const htmlStart = content.match(/<html\b[^>]*>/i);
	if (htmlStart?.index !== undefined) {
		const insertionIndex = htmlStart.index + htmlStart[0].length;
		return `${content.slice(0, insertionIndex)}<head>${csp}</head>${content.slice(insertionIndex)}`;
	}
	return `<!doctype html><html><head>${csp}</head><body>${content}</body></html>`;
}
