import type { FileTree, FileTreeDirectoryHandle, FileTreeItemHandle } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/ui/chat-message";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { MenuItem } from "@/components/ui/menu-item";
import { toast } from "@/components/ui/toast";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import { cn } from "cn";
import type {
	DesktopWorkspaceEntry,
	DesktopWorkspaceOpenApplication,
	DesktopWorkspaceOpenApplications,
} from "../../../shared/desktop-rpc";

interface WorkspacePanelProps {
	readonly sessionId: string;
	/** null 表示这个面板还没选文件，显示空态。 */
	readonly filePath: string | null;
	onOpenFile(path: string): void;
}

function treePathForEntry(entry: DesktopWorkspaceEntry): string {
	return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function workspacePathForTreePath(treePath: string): string {
	return treePath.endsWith("/") ? treePath.slice(0, -1) : treePath;
}

function asDirectoryHandle(item: FileTreeItemHandle | null): FileTreeDirectoryHandle | null {
	return item?.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
}

function canOpenInCursor(filePath: string): boolean {
	const extension = filePath.split(".").at(-1)?.toLowerCase();
	return new Set([
		"astro",
		"bash",
		"c",
		"cc",
		"cjs",
		"cpp",
		"cs",
		"css",
		"cts",
		"cxx",
		"env",
		"go",
		"gql",
		"graphql",
		"h",
		"hpp",
		"htm",
		"html",
		"java",
		"js",
		"json",
		"jsonc",
		"jsx",
		"kt",
		"kts",
		"less",
		"mjs",
		"md",
		"markdown",
		"mts",
		"php",
		"py",
		"rb",
		"rs",
		"sass",
		"scss",
		"sh",
		"sql",
		"svelte",
		"svg",
		"swift",
		"toml",
		"ts",
		"tsx",
		"vue",
		"xml",
		"yaml",
		"yml",
		"zsh",
	]).has(extension ?? "");
}

type WorkspaceFileState =
	| { readonly status: "empty" }
	| { readonly status: "loading" }
	| { readonly status: "error" }
	| { readonly status: "ready"; readonly content: string };

export function WorkspacePanel({ sessionId, filePath, onOpenFile }: WorkspacePanelProps) {
	const intl = useIntl();
	const icons = useIcons();
	const FolderIcon = icons.folder;
	const FolderOpenIcon = icons["folder-open"];
	const FileIcon = icons["file-code"];
	const SearchIcon = icons.search;
	const LoadingIcon = icons.loader;
	const PanelRightIcon = icons["panel-right"];
	const ChevronDownIcon = icons["chevron-down"];
	const TerminalIcon = icons.terminal;
	const reducedMotion = useReducedMotion();
	const [loadingPaths, setLoadingPaths] = useState<ReadonlySet<string>>(new Set());
	const [rootLoaded, setRootLoaded] = useState(false);
	const [treeCollapsed, setTreeCollapsed] = useState(false);
	const [file, setFile] = useState<WorkspaceFileState>({ status: "empty" });
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [openingTarget, setOpeningTarget] = useState<"default" | "cursor" | null>(null);
	const [openingApplicationId, setOpeningApplicationId] = useState<string | null>(null);
	const [openApplications, setOpenApplications] = useState<DesktopWorkspaceOpenApplications | null>(null);
	const treeModelRef = useRef<FileTree | null>(null);
	const treePathsRef = useRef(new Set<string>());
	const directoryPathsRef = useRef(new Set<string>());
	const loadedDirectoriesRef = useRef(new Set<string>());
	const directoryLoadsRef = useRef(new Map<string, Promise<void>>());
	const onOpenFileRef = useRef(onOpenFile);
	const selectionSyncRef = useRef(false);
	onOpenFileRef.current = onOpenFile;

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
					if (directoryPath === "") setRootLoaded(true);
					for (const entry of result.entries) {
						const treePath = treePathForEntry(entry);
						if (!treePathsRef.current.has(treePath)) {
							treePathsRef.current.add(treePath);
							treeModelRef.current?.add(treePath);
						}
						if (entry.kind === "directory") directoryPathsRef.current.add(entry.path);
					}
					setError(null);
				} catch {
					setError(
						directoryPath
							? intl.formatMessage(desktopMessages.workspaceReadDirectory)
							: intl.formatMessage(desktopMessages.workspaceReadRoot),
					);
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
		[sessionId, intl.formatMessage],
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

	const { model: treeModel } = useFileTree({
		paths: [],
		initialExpansion: "closed",
		flattenEmptyDirectories: true,
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
			onOpenFileRef.current(workspacePathForTreePath(selectedPath));
		},
	});
	treeModelRef.current = treeModel;

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
		if (!filePath) {
			setFile({ status: "empty" });
			return;
		}
		let cancelled = false;
		setFile({ status: "loading" });
		void (async () => {
			try {
				await ensureFilePathInTree(filePath);
				const result = await desktop.workspace.read({ sessionId, path: filePath });
				if (cancelled) return;
				setFile({ status: "ready", content: result.content });
				const selectedItem = treeModelRef.current?.getItem(filePath);
				if (selectedItem && !selectedItem.isSelected()) {
					selectionSyncRef.current = true;
					selectedItem.select();
				}
				treeModelRef.current?.scrollToPath(filePath, { focus: false, offset: "nearest" });
				setError(null);
			} catch {
				if (cancelled) return;
				setFile({ status: "error" });
				setError(intl.formatMessage(desktopMessages.workspaceReadFileError));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [ensureFilePathInTree, filePath, sessionId, intl.formatMessage]);

	useEffect(() => {
		setOpenApplications(null);
		if (!filePath) return;
		let cancelled = false;
		void desktop.workspace
			.openApplications({ sessionId, path: filePath })
			.then((result) => {
				if (!cancelled) setOpenApplications(result);
			})
			.catch(() => {
				if (!cancelled) setOpenApplications({ applications: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [filePath, sessionId]);

	const fileName = filePath?.split("/").at(-1) ?? null;
	const cursorOpenAvailable = filePath ? canOpenInCursor(filePath) : false;
	const defaultOpenApplication = openApplications?.defaultApplication;
	const openControlsDisabled = !filePath || openingTarget !== null || openingApplicationId !== null;
	const isOpeningDefault = openingTarget === "default";
	const cursorOpenDisabled = openingTarget !== null || openingApplicationId !== null;
	const defaultOpenLabel = fileName
		? intl.formatMessage(desktopMessages.workspaceOpenDefault, { name: fileName })
		: intl.formatMessage(desktopMessages.workspaceOpenDefaultShort);
	const previewInitial = reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px)" };
	const treeLoading = loadingPaths.size > 0;
	const treeHostStyle = {
		"--trees-bg-override": "var(--surface-tertiary)",
		"--trees-selected-bg-override": "color-mix(in oklch, var(--foreground) 11%, var(--surface-tertiary))",
	} as CSSProperties;
	const openActiveFile = useCallback(
		async (target: "default" | "cursor" | "application", applicationId?: string) => {
			if (!filePath) return;
			if (target === "application") setOpeningApplicationId(applicationId ?? null);
			else setOpeningTarget(target);
			try {
				await desktop.workspace.open({
					sessionId,
					path: filePath,
					target,
					...(target === "application" && applicationId ? { applicationId } : {}),
				});
			} catch {
				toast.add({
					title: intl.formatMessage(
						target === "cursor"
							? desktopMessages.workspaceOpenCursorError
							: desktopMessages.workspaceOpenFileError,
					),
					description: intl.formatMessage(desktopMessages.workspaceOpenFileError),
					type: "error",
				});
			} finally {
				if (target === "application") setOpeningApplicationId(null);
				else setOpeningTarget(null);
			}
		},
		[filePath, sessionId, intl.formatMessage],
	);
	const defaultOpenIcon = defaultOpenApplication?.iconDataUrl ? (
		<img src={defaultOpenApplication.iconDataUrl} alt="" className="size-4 shrink-0" />
	) : (
		<FolderOpenIcon size={14} />
	);
	const applicationMenuItems = (openApplications?.applications ?? []).map((application, index) => (
		<ApplicationMenuItem
			key={application.id}
			application={application}
			index={index}
			opening={openingApplicationId === application.id}
			disabled={openingTarget !== null || (openingApplicationId !== null && openingApplicationId !== application.id)}
			onSelect={() => void openActiveFile("application", application.id)}
		/>
	));
	const cursorOpenMenuItem = cursorOpenAvailable ? (
		<MenuItem
			index={1}
			icon={TerminalIcon}
			label={intl.formatMessage(desktopMessages.workspaceOpenCursor)}
			disabled={cursorOpenDisabled}
			onSelect={() => void openActiveFile("cursor")}
		/>
	) : null;
	const fallbackOpenMenuItems = applicationMenuItems.length
		? applicationMenuItems
		: [
				<MenuItem
					key="default"
					index={0}
					icon={FolderOpenIcon}
					label={intl.formatMessage(desktopMessages.workspaceOpenDefaultShort)}
					disabled={openControlsDisabled}
					onSelect={() => void openActiveFile("default")}
				/>,
				cursorOpenMenuItem,
			];
	return (
		<aside
			id="workspace-panel"
			aria-label={intl.formatMessage(desktopMessages.workspaceFiles)}
			className="flex h-full w-full min-w-0 flex-col"
		>
			<div className="flex h-10 shrink-0 items-center gap-2 px-3 text-[12px] text-muted-foreground">
				<FolderOpenIcon size={14} className="shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate" title={filePath ?? "/"}>
					{filePath ?? "/"}
				</span>
				<div className="flex shrink-0 overflow-hidden rounded-lg">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						loading={isOpeningDefault}
						disabled={openControlsDisabled}
						onClick={() => void openActiveFile("default")}
						aria-label={defaultOpenLabel}
						title={defaultOpenLabel}
						className="h-7 rounded-r-none px-2.5"
						labelClassName="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
					>
						{defaultOpenIcon}
						{intl.formatMessage(desktopMessages.workspaceOpen)}
					</Button>
					<DropdownMenu disabled={openControlsDisabled}>
						<DropdownTrigger
							render={
								<Button
									type="button"
									variant="secondary"
									size="icon"
									disabled={openControlsDisabled}
									aria-label={intl.formatMessage(desktopMessages.workspaceChooseOpen)}
									title={intl.formatMessage(desktopMessages.workspaceChooseOpen)}
									className="h-7 w-7 rounded-l-none border-l border-foreground/10"
								>
									<ChevronDownIcon size={14} />
								</Button>
							}
						/>
						<DropdownContent align="end" className="w-52">
							{fallbackOpenMenuItems}
						</DropdownContent>
					</DropdownMenu>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={intl.formatMessage(
						treeCollapsed ? desktopMessages.workspaceExpandTree : desktopMessages.workspaceCollapseTree,
					)}
					title={intl.formatMessage(
						treeCollapsed ? desktopMessages.workspaceExpandTree : desktopMessages.workspaceCollapseTree,
					)}
					aria-pressed={!treeCollapsed}
					onClick={() => setTreeCollapsed((current) => !current)}
					className="shrink-0 text-muted-foreground"
				>
					<PanelRightIcon size={15} className={cn({ "rotate-180": treeCollapsed })} />
				</Button>
			</div>
			<div
				className={cn(
					"grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-out",
					treeCollapsed ? "grid-cols-[minmax(0,1fr)_0fr]" : "grid-cols-[minmax(0,1fr)_minmax(11rem,42%)]",
				)}
			>
				<section className="flex min-h-0 min-w-0 flex-col">
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={`${filePath ?? ""}:${file.status}`}
							initial={previewInitial}
							animate={{ opacity: 1, transform: "translateY(0)" }}
							transition={{ duration: reducedMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
							className="min-h-0 min-w-0 flex-1 overflow-y-auto"
						>
							{file.status === "empty" ? (
								<div className="flex h-full min-h-72 flex-col items-center justify-center px-5 py-10 text-center">
									<FolderIcon size={24} className="text-muted-foreground" />
									<h2 className="mt-3 text-[14px] font-medium">
										{intl.formatMessage(desktopMessages.workspaceChooseFile)}
									</h2>
									<p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
										{intl.formatMessage(desktopMessages.workspaceChooseFileDescription)}
									</p>
								</div>
							) : file.status === "loading" ? (
								<div className="flex h-full min-h-72 items-center justify-center gap-2 text-[12px] text-muted-foreground">
									<LoadingIcon size={16} className="animate-spin" />
									{intl.formatMessage(desktopMessages.workspaceReadingFile)}
								</div>
							) : file.status === "error" ? (
								<div className="flex h-full min-h-72 flex-col items-center justify-center px-5 text-center">
									<FileIcon size={22} className="text-muted-foreground" />
									<p className="mt-3 text-[13px] font-medium">
										{intl.formatMessage(desktopMessages.workspaceFileUnavailable)}
									</p>
									<p className="mt-1 text-[12px] text-muted-foreground">
										{error ?? intl.formatMessage(desktopMessages.workspaceReadFileError)}
									</p>
								</div>
							) : (
								<FilePreview path={filePath ?? ""} content={file.content} />
							)}
						</motion.div>
					</AnimatePresence>
				</section>

				<section
					className={cn(
						"flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-surface-tertiary",
						treeCollapsed && "pointer-events-none opacity-0",
					)}
					aria-hidden={treeCollapsed}
					inert={treeCollapsed}
				>
					<div className="relative shrink-0 p-2.5 pb-2">
						<div className="relative min-w-0 flex-1">
							<SearchIcon
								size={15}
								className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={intl.formatMessage(desktopMessages.workspaceFilter)}
								aria-label={intl.formatMessage(desktopMessages.workspaceFilter)}
								density="compact"
								className="h-8 pl-8 pr-8"
							/>
						</div>
						{treeLoading ? (
							<LoadingIcon
								size={13}
								className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 animate-spin text-muted-foreground"
							/>
						) : null}
					</div>
					<div className="min-h-0 min-w-0 flex-1 overflow-hidden px-1.5 pb-2.5">
						{rootLoaded ? (
							<PierreFileTree
								model={treeModel}
								className="pierre-trees-host"
								style={treeHostStyle}
								aria-label={intl.formatMessage(desktopMessages.workspaceTree)}
							/>
						) : (
							<div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground">
								{treeLoading ? <LoadingIcon size={14} className="animate-spin" /> : null}
								{error ?? intl.formatMessage(desktopMessages.workspaceReading)}
							</div>
						)}
					</div>
				</section>
			</div>
		</aside>
	);
}

function ApplicationMenuItem({
	application,
	disabled,
	index,
	onSelect,
	opening,
}: {
	readonly application: DesktopWorkspaceOpenApplication;
	readonly disabled: boolean;
	readonly index: number;
	readonly opening: boolean;
	onSelect(): void;
}) {
	const intl = useIntl();
	const applicationIcon = application.iconDataUrl ? (
		<img src={application.iconDataUrl} alt="" className="size-4 shrink-0" />
	) : null;
	const label = intl.formatMessage(
		application.isDefault ? desktopMessages.workspaceOpenDefault : desktopMessages.workspaceOpenWith,
		{ name: application.name },
	);
	return (
		<MenuItem
			index={index}
			label={label}
			leadingVisual={applicationIcon}
			disabled={disabled}
			onSelect={onSelect}
			className={cn(opening && "opacity-50")}
		/>
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
