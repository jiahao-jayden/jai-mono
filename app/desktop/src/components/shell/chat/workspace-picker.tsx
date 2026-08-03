import { useState } from "react";
import { useIcons } from "@/lib/icon-context";
import type { DesktopWorkspace } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

interface WorkspacePickerProps {
	readonly workspace?: DesktopWorkspace;
	readonly workspaces: readonly DesktopWorkspace[];
	readonly disabled: boolean;
	readonly busy: boolean;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onChoose: (workspace: DesktopWorkspace) => Promise<void>;
	readonly onAdd: () => Promise<void>;
	readonly onRetry: () => void;
}

export function WorkspacePicker({
	workspace,
	workspaces,
	disabled,
	busy,
	loading,
	loadError,
	onChoose,
	onAdd,
	onRetry,
}: WorkspacePickerProps) {
	const icons = useIcons();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const FolderIcon = icons.folder;
	const FolderOffIcon = icons["folder-off"];
	const SearchIcon = icons.search;
	const ChevronDownIcon = icons["chevron-down"];
	const WorkspaceIcon = workspace && !workspace.available ? FolderOffIcon : FolderIcon;
	const label = busy
		? "Updating workspace…"
		: loading && workspaces.length === 0
			? "Loading workspaces…"
			: loadError
				? "Workspaces unavailable"
				: workspace
					? workspace.available
						? workspace.displayName
						: `${workspace.displayName} (Relink)`
					: "Work in a project or folder";
	const triggerDisabled = disabled || busy || (loading && workspaces.length === 0);
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const filteredWorkspaces = normalizedQuery
		? workspaces.filter(
				(candidate) =>
					candidate.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
					candidate.path.toLocaleLowerCase().includes(normalizedQuery),
			)
		: workspaces;
	const checkedIndex = filteredWorkspaces.findIndex((candidate) => candidate.id === workspace?.id);

	return (
		<>
			<DropdownMenu
				open={open}
				onOpenChange={(nextOpen) => {
					setOpen(nextOpen);
					if (!nextOpen) setQuery("");
				}}
				disabled={triggerDisabled}
			>
				<DropdownTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={triggerDisabled}
							active={open}
							className="min-w-0 max-w-72 gap-1.5 px-2.5 text-[13px] text-muted-foreground"
							aria-label={`Workspace: ${label}`}
							title={
								workspace && !workspace.available ? "This folder is unavailable. Choose it to relink." : label
							}
						>
							<span className="flex min-w-0 items-center gap-1.5">
								<WorkspaceIcon
									size={14}
									className={
										workspace && !workspace.available ? "text-destructive" : "text-muted-foreground/70"
									}
								/>
								<span className="truncate">{label}</span>
								<ChevronDownIcon
									size={10}
									className={`shrink-0 opacity-50 transition-transform duration-150 ${
										open ? "rotate-180" : ""
									}`}
								/>
							</span>
						</Button>
					}
				/>
				<DropdownContent
					checkedIndex={checkedIndex >= 0 ? checkedIndex : undefined}
					sideOffset={6}
					className="w-90"
				>
					<div className="mb-0.5 flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
						<SearchIcon size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== "Escape") event.stopPropagation();
							}}
							aria-label="Search projects"
							placeholder="Search projects"
							className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground"
						/>
					</div>
					{loadError ? (
						<MenuItem index={0} icon={icons["rotate-ccw"]} label="Retry loading workspaces" onSelect={onRetry} />
					) : (
						<>
							{filteredWorkspaces.map((candidate, index) => (
								<MenuItem
									key={candidate.id}
									index={index}
									icon={candidate.available ? FolderIcon : FolderOffIcon}
									label={`${candidate.displayName}${candidate.available ? "" : " (Relink)"}`}
									description={candidate.path}
									title={candidate.path}
									checked={candidate.id === workspace?.id}
									onSelect={() => void onChoose(candidate)}
								/>
							))}
							{filteredWorkspaces.length === 0 ? (
								<p className="px-2 py-2.5 text-[12px] text-muted-foreground">
									{workspaces.length === 0 ? "No workspace yet" : "No matching projects"}
								</p>
							) : null}
						</>
					)}
					{!loadError ? (
						<>
							<DropdownSeparator />
							<MenuItem
								index={filteredWorkspaces.length}
								icon={icons.plus}
								label="Add a folder"
								onSelect={() => void onAdd()}
							/>
						</>
					) : null}
				</DropdownContent>
			</DropdownMenu>
			<span className="sr-only" role="status" aria-live="polite">
				{busy ? "Updating workspace" : ""}
			</span>
		</>
	);
}
