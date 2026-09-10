import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { cn } from "cn";
import type { DesktopProject } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";
import { CreateProjectDialog } from "../create-project-dialog";

interface ProjectPickerProps {
	readonly project?: DesktopProject;
	readonly projects: readonly DesktopProject[];
	readonly disabled: boolean;
	readonly busy: boolean;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onChoose: (project: DesktopProject) => Promise<void>;
	readonly onRetry: () => void;
}

export function ProjectPicker({
	project,
	projects,
	disabled,
	busy,
	loading,
	loadError,
	onChoose,
	onRetry,
}: ProjectPickerProps) {
	const intl = useIntl();
	const icons = useIcons();
	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const FolderIcon = icons.folder;
	const FolderOffIcon = icons["folder-off"];
	const ChevronDownIcon = icons["chevron-down"];
	const ProjectIcon = project && !project.available ? FolderOffIcon : FolderIcon;
	const label = busy
		? intl.formatMessage(desktopMessages.projectPickerUpdating)
		: loading && projects.length === 0
			? intl.formatMessage(desktopMessages.projectPickerLoading)
			: loadError
				? intl.formatMessage(desktopMessages.projectPickerUnavailable)
				: project
					? project.available
						? project.displayName
						: intl.formatMessage(desktopMessages.projectPickerRelinkLabel, { name: project.displayName })
					: intl.formatMessage(desktopMessages.projectPickerWorkIn);
	const triggerDisabled = disabled || busy || (loading && projects.length === 0);
	const checkedIndex = projects.findIndex((candidate) => candidate.id === project?.id);

	return (
		<>
			<DropdownMenu
				open={open}
				onOpenChange={setOpen}
				disabled={triggerDisabled}
			>
				<DropdownTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="chip"
							disabled={triggerDisabled}
							active={open}
							className="min-w-0 max-w-72"
							aria-label={intl.formatMessage(desktopMessages.projectPickerAria, { label })}
							title={
								project && !project.available ? intl.formatMessage(desktopMessages.projectPickerRelink) : label
							}
						>
							<span className="flex min-w-0 items-center gap-1">
								<ProjectIcon size={14} className={cn({ "text-destructive": project && !project.available })} />
								<span className="truncate">{label}</span>
								<ChevronDownIcon
									size={14}
									className={cn("shrink-0 opacity-50 transition-transform duration-150", {
										"rotate-180": open,
									})}
								/>
							</span>
						</Button>
					}
				/>
				<DropdownContent
					checkedIndex={checkedIndex >= 0 ? checkedIndex : undefined}
					sideOffset={6}
					className="w-64"
				>
					{loadError ? (
						<MenuItem
							index={0}
							icon={icons["rotate-ccw"]}
							label={intl.formatMessage(desktopMessages.projectPickerRetry)}
							onSelect={onRetry}
						/>
					) : (
						<>
							{projects.map((candidate, index) => (
								<MenuItem
									key={candidate.id}
									index={index}
									icon={candidate.available ? FolderIcon : FolderOffIcon}
									label={
										candidate.available
											? candidate.displayName
											: intl.formatMessage(desktopMessages.projectPickerRelinkLabel, {
													name: candidate.displayName,
												})
									}
									title={candidate.path}
									checked={candidate.id === project?.id}
									onSelect={() => void onChoose(candidate)}
								/>
							))}
							{projects.length === 0 ? (
								<p className="px-2 py-2.5 text-[12px] text-muted-foreground">
									{intl.formatMessage(desktopMessages.projectPickerNoProject)}
								</p>
							) : null}
						</>
					)}
					{!loadError ? (
						<>
							<DropdownSeparator />
							<MenuItem
								index={projects.length}
								icon={icons.plus}
								label={intl.formatMessage(desktopMessages.projectCreateStart)}
								onSelect={() => setCreating(true)}
							/>
						</>
					) : null}
				</DropdownContent>
			</DropdownMenu>
			<CreateProjectDialog open={creating} onOpenChange={setCreating} onCreated={onChoose} />
			<span className="sr-only" role="status" aria-live="polite">
				{busy ? intl.formatMessage(desktopMessages.projectPickerUpdating) : ""}
			</span>
		</>
	);
}
