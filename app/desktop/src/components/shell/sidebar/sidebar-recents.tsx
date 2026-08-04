import type { CodingSession } from "@jai/coding/business";
import { getErrorMessage } from "@jai/common";
import { type FormEvent, useState } from "react";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopWorkspace } from "../../../../shared/desktop-rpc";
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
	workspaces: readonly DesktopWorkspace[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	onSelectSession(sessionId: string): void;
	onRenameSession(sessionId: string, title: string): Promise<void>;
	onMoveSession(sessionId: string, workspaceId: string | null): Promise<void>;
	onDeleteSession(sessionId: string): Promise<void>;
	onLoadMore?(): void;
}

export function SidebarRecents({
	sessions,
	workspaces,
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
	return (
		<>
			<div className="px-5 pt-5 pb-1.5">
				<span className="text-[12px] font-semibold text-muted-foreground">Recents</span>
			</div>

			<div className="scrollbar-hidden min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-2">
				{loading && sessions.length === 0 ? (
					<div className="space-y-2 px-2.5 py-2" role="status" aria-label="Loading recent sessions">
						{[0, 1, 2].map((item) => (
							<div key={item} className="h-8 animate-pulse rounded-lg bg-foreground/5" />
						))}
					</div>
				) : null}
				{error ? (
					<p className="mx-2.5 my-2 rounded-lg bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive">
						Recents 暂时无法加载。请稍后重试。
					</p>
				) : null}
				{!loading && !error && sessions.length === 0 ? (
					<p className="px-2.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">新对话会保存在这里。</p>
				) : null}
				{sessions.map((session) => {
					const selected = session.id === activeSessionId;
					return (
						<div className="group relative" key={session.id}>
							<Button
								type="button"
								variant="navigation"
								size="md"
								onClick={() => onSelectSession(session.id)}
								aria-current={selected ? "page" : undefined}
								active={selected}
								contentClassName="w-full min-w-0"
								labelClassName="min-w-0 flex-1 [text-box:normal]"
								className={cn(
									"h-8 w-full justify-start rounded-lg pr-9 pl-2.5 text-left text-[13px] font-normal",
									selected ? "text-foreground" : "text-foreground/80",
								)}
							>
								<span className="block truncate">{session.title}</span>
							</Button>
							<SessionActions
								session={session}
								workspaces={workspaces}
								visible={selected}
								onRename={onRenameSession}
								onMove={onMoveSession}
								onDelete={onDeleteSession}
							/>
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
						{loadingMore ? "Loading more…" : "Load more"}
					</Button>
				) : null}
			</div>
		</>
	);
}

type SessionActionDialog = "rename" | "delete" | null;

function SessionActions({
	session,
	workspaces,
	visible,
	onRename,
	onMove,
	onDelete,
}: {
	readonly session: CodingSession;
	readonly workspaces: readonly DesktopWorkspace[];
	readonly visible: boolean;
	readonly onRename: (sessionId: string, title: string) => Promise<void>;
	readonly onMove: (sessionId: string, workspaceId: string | null) => Promise<void>;
	readonly onDelete: (sessionId: string) => Promise<void>;
}) {
	const icons = useIcons();
	const [menuOpen, setMenuOpen] = useState(false);
	const [dialog, setDialog] = useState<SessionActionDialog>(null);
	const [title, setTitle] = useState(session.title);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const MoreVerticalIcon = icons["more-vertical"];
	const destinationWorkspaces = workspaces.filter((workspace) => workspace.id !== session.workspaceId);

	const openDialog = (next: Exclude<SessionActionDialog, null>) => {
		setError(undefined);
		if (next === "rename") setTitle(session.title);
		setDialog(next);
	};

	const closeDialog = () => {
		if (pending) return;
		setDialog(null);
		setError(undefined);
	};

	const rename = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const nextTitle = title.trim();
		if (!nextTitle || pending) return;
		setPending(true);
		setError(undefined);
		try {
			await onRename(session.id, nextTitle);
			setDialog(null);
		} catch (reason) {
			setError(getErrorMessage(reason));
		} finally {
			setPending(false);
		}
	};

	const move = async (workspaceId: string | null) => {
		if (pending || workspaceId === session.workspaceId) return;
		setPending(true);
		try {
			await onMove(session.id, workspaceId);
		} catch (reason) {
			toast.add({
				title: "无法移动会话",
				description: getErrorMessage(reason),
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
		} catch (reason) {
			setError(getErrorMessage(reason));
			setPending(false);
		}
	};

	const removeFromProject = async () => {
		if (pending || session.workspaceId === null) return;
		setPending(true);
		try {
			await onMove(session.id, null);
		} catch (reason) {
			toast.add({
				title: "无法从项目移除",
				description: getErrorMessage(reason),
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
							aria-label={`Actions for ${session.title}`}
							title="Session actions"
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
						label="Rename"
						className="h-8 px-2"
						onSelect={() => openDialog("rename")}
					/>
					<DropdownSubmenu>
						<MenuItem
							index={1}
							icon={icons["folder-open"]}
							trailingIcon={icons["chevron-right"]}
							label="移动到项目"
							submenu
							className="h-8 px-2"
						/>
						<DropdownSubmenuContent hoverVariant="navigation">
							{destinationWorkspaces.length > 0 ? (
								destinationWorkspaces.map((workspace, index) => (
									<MenuItem
										key={workspace.id}
										index={index}
										icon={workspace.available ? icons.folder : icons["folder-off"]}
										label={workspace.displayName}
										description={workspace.path}
										disabled={pending || !workspace.available}
									className="min-h-10 py-1.5"
										onSelect={() => void move(workspace.id)}
									/>
								))
							) : (
								<MenuItem index={0} label="暂无可用项目" disabled />
							)}
						</DropdownSubmenuContent>
					</DropdownSubmenu>
					{session.workspaceId !== null ? (
						<MenuItem
							index={2}
							icon={icons["folder-off"]}
							label="从项目移除"
							className="h-8 px-2"
							onSelect={() => void removeFromProject()}
						/>
					) : null}
					<DropdownSeparator />
					<MenuItem
						index={session.workspaceId === null ? 2 : 3}
						icon={icons.trash}
						label="Delete"
						variant="destructive"
						className="h-8 px-2"
						onSelect={() => openDialog("delete")}
					/>
				</DropdownContent>
			</DropdownMenu>

			<Dialog open={dialog === "rename"} onOpenChange={(open) => !open && closeDialog()}>
				<DialogContent>
					<form onSubmit={rename}>
						<DialogHeader>
							<DialogTitle>Rename session</DialogTitle>
							<DialogDescription>Give this conversation a name that is easy to find later.</DialogDescription>
						</DialogHeader>
						<Input
							autoFocus
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							aria-label="Session name"
							maxLength={80}
						/>
						<ActionError message={error} />
						<DialogFooter>
							<Button type="button" variant="ghost" disabled={pending} onClick={closeDialog}>
								Cancel
							</Button>
							<Button type="submit" loading={pending} disabled={!title.trim()}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={dialog === "delete"} onOpenChange={(open) => !open && closeDialog()}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete session?</DialogTitle>
						<DialogDescription>
							“{session.title}” and its local conversation history will be permanently deleted.
						</DialogDescription>
					</DialogHeader>
					<ActionError message={error} />
					<DialogFooter>
						<Button type="button" variant="ghost" disabled={pending} onClick={closeDialog}>
							Cancel
						</Button>
						<Button
							type="button"
							variant="tertiary"
							loading={pending}
							onClick={() => void remove()}
							className="text-destructive"
						>
							Delete
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
