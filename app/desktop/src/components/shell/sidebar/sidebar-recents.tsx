import { useRef, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { CodingSession, DesktopProject } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import {
	DropdownContent,
	DropdownMenu,
	DropdownSeparator,
	DropdownSubmenu,
	DropdownSubmenuContent,
	DropdownTrigger,
} from "../../ui/dropdown";
import { Input } from "../../ui/input";
import { MenuItem } from "../../ui/menu-item";
import { toast } from "../../ui/toast";

interface SidebarRecentsProps {
	sessions: readonly CodingSession[];
	projects: readonly DesktopProject[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	onSelectSession(sessionId: string): void;
	onRenameSession(sessionId: string, title: string): Promise<void>;
	onMoveSession(sessionId: string, projectId: string | null): Promise<void>;
	onDeleteSession(sessionId: string): Promise<void>;
	onLoadMore?(): void;
}

export function SidebarRecents({
	sessions,
	projects,
	activeSessionId,
	loading,
	error,
	hasNextPage = false,
	loadingMore = false,
	onSelectSession,
	onRenameSession,
	onMoveSession,
	onDeleteSession,
	onLoadMore,
}: SidebarRecentsProps) {
	const intl = useIntl();
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const cancelEditRef = useRef(false);

	const startEditing = (session: CodingSession) => {
		cancelEditRef.current = false;
		setEditingTitle(session.title);
		setEditingSessionId(session.id);
	};

	const cancelEditing = () => {
		cancelEditRef.current = true;
		setEditingSessionId(null);
	};

	const saveEditing = async (session: CodingSession) => {
		if (cancelEditRef.current) {
			cancelEditRef.current = false;
			return;
		}

		setEditingSessionId(null);
		const title = editingTitle.trim();
		if (!title || title === session.title) return;

		try {
			await onRenameSession(session.id, title);
		} catch {
			toast.add({
				title: intl.formatMessage(desktopMessages.sidebarRenameFailed),
				description: intl.formatMessage(desktopMessages.sidebarRenameFailed),
				type: "error",
			});
		}
	};

	return (
		<>
			<div className="px-5 pt-5 pb-1.5">
				<span className="text-[12px] font-semibold text-muted-foreground">
					{intl.formatMessage(desktopMessages.sidebarRecents)}
				</span>
			</div>

			<div className="scrollbar-hidden min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-2">
				{loading && sessions.length === 0 ? (
					<div
						className="space-y-2 px-2.5 py-2"
						role="status"
						aria-label={intl.formatMessage(desktopMessages.sidebarLoadingRecentSessions)}
					>
						{[0, 1, 2].map((item) => (
							<div key={item} className="h-8 animate-pulse rounded-lg bg-foreground/5" />
						))}
					</div>
				) : null}
				{error ? (
					<p className="mx-2.5 my-2 rounded-lg bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive">
						{intl.formatMessage(desktopMessages.sidebarRecentsLoadError)}
					</p>
				) : null}
				{!loading && !error && sessions.length === 0 ? (
					<p className="px-2.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
						{intl.formatMessage(desktopMessages.sidebarNoRecentSessions)}
					</p>
				) : null}
				{sessions.map((session) => {
					const selected = session.id === activeSessionId;
					const editing = session.id === editingSessionId;
					return (
						<div className="group relative" key={session.id}>
							{editing ? (
								<Input
									autoFocus
									density="compact"
									value={editingTitle}
									onChange={(event) => setEditingTitle(event.target.value)}
									onBlur={() => void saveEditing(session)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											event.currentTarget.blur();
										} else if (event.key === "Escape") {
											event.preventDefault();
											cancelEditing();
										}
									}}
									aria-label={intl.formatMessage(desktopMessages.sessionTitle)}
									maxLength={80}
									className="h-8 rounded-lg border-border bg-sidebar px-2.5 text-[13.5px] font-normal focus-visible:ring-0"
								/>
							) : (
								<>
									<Button
										type="button"
										variant="navigation"
										size="md"
										onClick={() => onSelectSession(session.id)}
										onDoubleClick={() => selected && startEditing(session)}
										onKeyDown={(event) => {
											if (selected && event.key === "F2") {
												event.preventDefault();
												startEditing(session);
											}
										}}
										aria-current={selected ? "page" : undefined}
										active={selected}
										contentClassName="w-full min-w-0"
										labelClassName="min-w-0 flex-1 [text-box:normal]"
										className={cn(
											"h-8 w-full justify-start rounded-lg pr-9 pl-2.5 text-left text-[13.5px] font-normal",
											selected ? "text-foreground" : "text-foreground/85",
										)}
									>
										<span className="block truncate">{session.title}</span>
									</Button>
									<SessionActions
										session={session}
										projects={projects}
										visible={selected}
										onStartRename={() => startEditing(session)}
										onMove={onMoveSession}
										onDelete={onDeleteSession}
									/>
								</>
							)}
						</div>
					);
				})}
				{hasNextPage ? (
					<Button
						type="button"
						variant="navigation"
						size="sm"
						disabled={loadingMore}
						onClick={onLoadMore}
						className="mt-1 w-full justify-center rounded-lg text-[12px] text-muted-foreground"
					>
						{intl.formatMessage(
							loadingMore ? desktopMessages.sidebarLoadingMore : desktopMessages.sidebarLoadMore,
						)}
					</Button>
				) : null}
			</div>
		</>
	);
}

type SessionActionDialog = "delete" | null;

function SessionActions({
	session,
	projects,
	visible,
	onStartRename,
	onMove,
	onDelete,
}: {
	readonly session: CodingSession;
	readonly projects: readonly DesktopProject[];
	readonly visible: boolean;
	readonly onStartRename: () => void;
	readonly onMove: (sessionId: string, projectId: string | null) => Promise<void>;
	readonly onDelete: (sessionId: string) => Promise<void>;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const [menuOpen, setMenuOpen] = useState(false);
	const [dialog, setDialog] = useState<SessionActionDialog>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const MoreVerticalIcon = icons["more-vertical"];
	const destinationProjects = projects.filter((project) => project.id !== session.projectId);

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
							variant="navigation"
							size="icon-sm"
							active={menuOpen}
							aria-label={intl.formatMessage(desktopMessages.sidebarActionsFor, { title: session.title })}
							title={intl.formatMessage(desktopMessages.sidebarSessionActions)}
							data-session-actions
							className={cn(
								"absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-lg text-foreground transition-opacity",
								visible || menuOpen
									? "visible opacity-100"
									: "invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
							)}
						>
							<MoreVerticalIcon size={16} strokeWidth={1.5} />
						</Button>
					}
				/>
				<DropdownContent
					side="bottom"
					align="end"
					sideOffset={6}
					hoverVariant="navigation"
					className="w-48 gap-0.5 p-1"
				>
					<MenuItem
						index={0}
						icon={icons.pencil}
						label={intl.formatMessage(desktopMessages.sidebarRename)}
						className="h-8 px-2"
						onSelect={onStartRename}
					/>
					<DropdownSubmenu>
						<MenuItem
							index={1}
							icon={icons["folder-open"]}
							trailingIcon={icons["chevron-right"]}
							label={intl.formatMessage(desktopMessages.sidebarMoveToProject)}
							submenu
							className="h-8 px-2"
						/>
						<DropdownSubmenuContent hoverVariant="navigation">
							{destinationProjects.length > 0 ? (
								destinationProjects.map((project, index) => (
									<MenuItem
										key={project.id}
										index={index}
										icon={project.available ? icons.folder : icons["folder-off"]}
										label={project.displayName}
										description={project.path}
										disabled={pending || !project.available}
										className="min-h-10 py-1.5"
										onSelect={() => void move(project.id)}
									/>
								))
							) : (
								<MenuItem
									index={0}
									label={intl.formatMessage(desktopMessages.sidebarNoAvailableProjects)}
									disabled
								/>
							)}
						</DropdownSubmenuContent>
					</DropdownSubmenu>
					{session.projectId !== null ? (
						<MenuItem
							index={2}
							icon={icons["folder-off"]}
							label={intl.formatMessage(desktopMessages.sidebarRemoveFromProject)}
							className="h-8 px-2"
							onSelect={() => void removeFromProject()}
						/>
					) : null}
					<DropdownSeparator />
					<MenuItem
						index={session.projectId === null ? 2 : 3}
						icon={icons.trash}
						label={intl.formatMessage(desktopMessages.commonDelete)}
						variant="destructive"
						className="h-8 px-2"
						onSelect={openDialog}
					/>
				</DropdownContent>
			</DropdownMenu>

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
