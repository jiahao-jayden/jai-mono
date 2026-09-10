import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { cn } from "cn";
import type { CodingSession, DesktopProject } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import {
	DropdownContent,
	DropdownMenu,
	DropdownSeparator,
	DropdownSubmenu,
	DropdownSubmenuContent,
	DropdownTrigger,
} from "../ui/dropdown";
import { MenuItem } from "../ui/menu-item";
import { toast } from "../ui/toast";
import { CreateProjectDialog } from "./create-project-dialog";

type SessionActionDialog = "delete" | null;

export function SessionActions({
	session,
	projects,
	visible = true,
	placement = "sidebar",
	onStartRename,
	onMove,
	onDelete,
}: {
	readonly session: CodingSession;
	readonly projects: readonly DesktopProject[];
	readonly visible?: boolean;
	readonly placement?: "sidebar" | "header";
	readonly onStartRename: () => void;
	readonly onMove: (sessionId: string, projectId: string | null) => Promise<void>;
	readonly onDelete: (sessionId: string) => Promise<void>;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const [menuOpen, setMenuOpen] = useState(false);
	const [dialog, setDialog] = useState<SessionActionDialog>(null);
	const [creatingProject, setCreatingProject] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const MoreVerticalIcon = icons["more-vertical"];
	const destinationProjects = projects.filter((project) => project.id !== session.projectId);
	const menuSide = placement === "header" ? "bottom" : "right";
	const triggerVariant = placement === "header" ? "ghost" : "navigation";
	const triggerClassName = cn("shrink-0 rounded-[6px] text-muted-foreground transition-opacity", {
		"absolute top-1/2 right-1 size-5 -translate-y-1/2": placement === "sidebar",
		"invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100":
			!visible && !menuOpen,
	});
	const removeProjectIndex = Math.max(destinationProjects.length, 1);
	const copySessionId = async () => {
		try {
			await navigator.clipboard.writeText(session.id);
			toast.add({ title: intl.formatMessage(desktopMessages.commonCopied), type: "success" });
		} catch {
			toast.add({ title: intl.formatMessage(desktopMessages.commonCopyFailed), type: "error" });
		}
	};

	const openDialog = () => {
		setError(undefined);
		setDialog("delete");
	};

	const closeDialog = () => {
		if (pending) return;
		setDialog(null);
		setError(undefined);
	};

	const move = async (projectId: string | null) => {
		if (pending || projectId === session.projectId) return;
		setPending(true);
		try {
			await onMove(session.id, projectId);
		} catch {
			toast.add({
				title: intl.formatMessage(desktopMessages.sidebarMoveFailed),
				description: intl.formatMessage(desktopMessages.sidebarMoveFailed),
				type: "error",
			});
		} finally {
			setPending(false);
		}
	};

	const remove = async () => {
		if (pending) return;
		setPending(true);
		setError(undefined);
		try {
			await onDelete(session.id);
			setDialog(null);
		} catch {
			setError(intl.formatMessage(desktopMessages.sidebarDeleteFailed));
			setPending(false);
		}
	};

	const removeFromProject = async () => {
		if (pending || session.projectId === null) return;
		setPending(true);
		try {
			await onMove(session.id, null);
		} catch {
			toast.add({
				title: intl.formatMessage(desktopMessages.sidebarRemoveFromProjectFailed),
				description: intl.formatMessage(desktopMessages.sidebarRemoveFromProjectFailed),
				type: "error",
			});
		} finally {
			setPending(false);
		}
	};

	return (
		<>
			<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<DropdownTrigger
					render={
						<Button
							type="button"
							variant={triggerVariant}
							size="icon-xs"
							active={menuOpen}
							aria-label={intl.formatMessage(desktopMessages.sidebarActionsFor, { title: session.title })}
							title={intl.formatMessage(desktopMessages.sidebarSessionActions)}
							data-session-actions
							className={triggerClassName}
						>
							<MoreVerticalIcon size={14} strokeWidth={1.5} className="rotate-90" />
						</Button>
					}
				/>
				<DropdownContent side={menuSide} align="start" sideOffset={6} className="w-52">
					<MenuItem
						index={0}
						icon={icons.pencil}
						label={intl.formatMessage(desktopMessages.sidebarRename)}
						onSelect={onStartRename}
						disabled={pending}
					/>
					<DropdownSubmenu>
						<MenuItem
							index={1}
							icon={icons["folder-open"]}
							trailingIcon={icons["chevron-right"]}
							label={intl.formatMessage(desktopMessages.sidebarMoveToProject)}
							submenu
						/>
						<DropdownSubmenuContent>
							{destinationProjects.length > 0 ? (
								destinationProjects.map((project, index) => {
									const ProjectIcon = project.available ? icons.folder : icons["folder-off"];
									return (
										<MenuItem
											key={project.id}
											index={index}
											icon={ProjectIcon}
											label={project.displayName}
											description={project.path}
											disabled={pending || !project.available}
											className="min-h-10 py-1.5"
											onSelect={() => void move(project.id)}
										/>
									);
								})
							) : (
								<MenuItem index={0} label={intl.formatMessage(desktopMessages.projectsEmpty)} disabled />
							)}
							{session.projectId !== null ? (
								<MenuItem
									index={removeProjectIndex}
									icon={icons["folder-off"]}
									label={intl.formatMessage(desktopMessages.sidebarRemoveFromProject)}
									onSelect={() => void removeFromProject()}
									disabled={pending}
								/>
							) : null}
							<DropdownSeparator />
							<MenuItem
								index={removeProjectIndex + 1}
								icon={icons.plus}
								label={intl.formatMessage(desktopMessages.projectCreateStart)}
								onSelect={() => setCreatingProject(true)}
								disabled={pending}
							/>
						</DropdownSubmenuContent>
					</DropdownSubmenu>
					<MenuItem
						index={2}
						icon={icons.copy}
						label={intl.formatMessage(desktopMessages.sessionCopyId)}
						onSelect={() => void copySessionId()}
					/>
					<DropdownSeparator />
					<MenuItem
						index={3}
						icon={icons.trash}
						label={intl.formatMessage(desktopMessages.commonDelete)}
						variant="destructive"
						onSelect={openDialog}
						disabled={pending}
					/>
				</DropdownContent>
			</DropdownMenu>

			<CreateProjectDialog
				open={creatingProject}
				onOpenChange={setCreatingProject}
				onCreated={(project) => move(project.id)}
			/>

			<Dialog open={dialog === "delete"} onOpenChange={(open) => !open && closeDialog()}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{intl.formatMessage(desktopMessages.sidebarDeleteSessionTitle)}</DialogTitle>
						<DialogDescription>
							{intl.formatMessage(desktopMessages.sidebarDeleteSessionDescription, { title: session.title })}
						</DialogDescription>
					</DialogHeader>
					<ActionError message={error} />
					<DialogFooter>
						<Button type="button" variant="ghost" disabled={pending} onClick={closeDialog}>
							{intl.formatMessage(desktopMessages.commonCancel)}
						</Button>
						<Button
							type="button"
							variant="tertiary"
							loading={pending}
							onClick={() => void remove()}
							className="text-destructive"
						>
							{intl.formatMessage(desktopMessages.commonDelete)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function ActionError({ message }: { readonly message?: string }) {
	return message ? (
		<p className="mt-3 text-[12px] leading-relaxed text-destructive" role="alert">
			{message}
		</p>
	) : null;
}
