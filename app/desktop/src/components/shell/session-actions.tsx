import { cn } from "cn";
import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import type { CodingSession } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "../ui/dropdown";
import { MenuItem } from "../ui/menu-item";
import { toast } from "../ui/toast";

type SessionActionDialog = "delete" | null;

export function SessionActions({
	session,
	visible = true,
	placement = "sidebar",
	running = false,
	onStartRename,
	onArchive,
	onDelete,
}: {
	readonly session: CodingSession;
	readonly visible?: boolean;
	readonly placement?: "sidebar" | "header";
	readonly running?: boolean;
	readonly onStartRename: () => void;
	readonly onArchive?: (sessionId: string) => Promise<void>;
	readonly onDelete: (sessionId: string) => Promise<void>;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const [menuOpen, setMenuOpen] = useState(false);
	const [dialog, setDialog] = useState<SessionActionDialog>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const MoreVerticalIcon = icons["more-vertical"];
	const menuSide = placement === "header" ? "bottom" : "right";
	const triggerVariant = placement === "header" ? "ghost" : "navigation";
	const triggerClassName = cn("shrink-0 rounded-[6px] text-muted-foreground transition-opacity", {
		"absolute top-1/2 right-1 size-5 -translate-y-1/2": placement === "sidebar",
		"invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100":
			!visible && !menuOpen,
	});
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
	const archive = async () => {
		if (pending || !onArchive) return;
		setPending(true);
		try {
			await onArchive(session.id);
		} catch {
			toast.add({ title: intl.formatMessage(desktopMessages.sidebarArchiveFailed), type: "error" });
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
					<MenuItem
						index={1}
						icon={icons.copy}
						label={intl.formatMessage(desktopMessages.sessionCopyId)}
						onSelect={() => void copySessionId()}
					/>
					{!running && onArchive ? (
						<MenuItem
							index={2}
							icon={icons.archive}
							label={intl.formatMessage(desktopMessages.sidebarArchive)}
							onSelect={() => void archive()}
							disabled={pending}
						/>
					) : null}
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
