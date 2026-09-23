import {
	cloneElement,
	isValidElement,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	useRef,
	useState,
} from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { type NativeMenuDescriptor, nativeMenuAnchor, showNativeMenu } from "@/lib/native-menu-icons";
import type { CodingSession } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { toast } from "../ui/toast";
import {
	SidebarHoverIconButton,
	SidebarRowHover,
	SidebarRowHoverActions,
	SidebarRowSpinner,
} from "./sidebar/sidebar-row-hover";

type SessionActionDialog = "delete" | null;

export function sessionContextMenuItems(input: {
	readonly running: boolean;
	readonly canArchive: boolean;
	readonly labels: {
		readonly rename: string;
		readonly copyId: string;
		readonly archive: string;
		readonly delete: string;
	};
}): NativeMenuDescriptor[] {
	const items: NativeMenuDescriptor[] = [
		{ id: "rename", label: input.labels.rename, icon: "pencil" },
		{ id: "copy-id", label: input.labels.copyId, icon: "copy" },
	];
	if (!input.running && input.canArchive) {
		items.push({ id: "archive", label: input.labels.archive, icon: "archive", separatorBefore: true });
	}
	items.push({
		id: "delete",
		label: input.labels.delete,
		icon: "trash",
		destructive: true,
		separatorBefore: true,
	});
	return items;
}

export function SessionActions({
	session,
	running = false,
	hoverActions = false,
	onStartRename,
	onPin,
	onArchive,
	onDelete,
	children,
}: {
	readonly session: CodingSession;
	readonly running?: boolean;
	readonly hoverActions?: boolean;
	readonly onStartRename: () => void;
	readonly onPin?: (sessionId: string, pinned: boolean) => Promise<void>;
	readonly onArchive?: (sessionId: string) => Promise<void>;
	readonly onDelete: (sessionId: string) => Promise<void>;
	readonly children: ReactNode;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const PinIcon = icons.pin;
	const ArchiveIcon = icons.archive;
	const [dialog, setDialog] = useState<SessionActionDialog>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const menuOpenRef = useRef(false);
	const pinned = session.pinnedAt !== null;
	const pinLabel = intl.formatMessage(pinned ? desktopMessages.sidebarUnpin : desktopMessages.sidebarPin);
	const archiveLabel = intl.formatMessage(desktopMessages.sidebarArchive);
	const canArchive = Boolean(onArchive) && !running;

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
	const pin = async () => {
		if (pending || !onPin) return;
		setPending(true);
		try {
			await onPin(session.id, !pinned);
		} catch {
			toast.add({
				title: intl.formatMessage(pinned ? desktopMessages.sidebarUnpinFailed : desktopMessages.sidebarPinFailed),
				type: "error",
			});
		} finally {
			setPending(false);
		}
	};

	const openMenu = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (pending || menuOpenRef.current) return;
		menuOpenRef.current = true;
		try {
			const id = await showNativeMenu(
				sessionContextMenuItems({
					running,
					canArchive: Boolean(onArchive),
					labels: {
						rename: intl.formatMessage(desktopMessages.sidebarRename),
						copyId: intl.formatMessage(desktopMessages.sessionCopyId),
						archive: archiveLabel,
						delete: intl.formatMessage(desktopMessages.commonDelete),
					},
				}),
				nativeMenuAnchor(event),
			);
			if (id === "rename") onStartRename();
			if (id === "copy-id") await copySessionId();
			if (id === "archive") await archive();
			if (id === "delete") openDialog();
		} catch {
			// The native menu is best-effort.
		} finally {
			menuOpenRef.current = false;
		}
	};

	const row = isValidElement(children)
		? cloneElement(children as ReactElement<{ onContextMenu?: (event: MouseEvent) => void }>, {
				onContextMenu: (event) => void openMenu(event),
			})
		: children;
	const pinButton = onPin ? (
		<SidebarHoverIconButton
			label={pinLabel}
			pressed={pinned}
			onClick={() => void pin()}
			onContextMenu={(event) => void openMenu(event)}
		>
			<PinIcon size={15} strokeWidth={1.5} />
		</SidebarHoverIconButton>
	) : null;
	const archiveButton = canArchive ? (
		<SidebarHoverIconButton
			label={archiveLabel}
			onClick={() => void archive()}
			onContextMenu={(event) => void openMenu(event)}
		>
			<ArchiveIcon size={15} strokeWidth={1.5} />
		</SidebarHoverIconButton>
	) : null;
	const showHoverActions = hoverActions && (pinButton !== null || archiveButton !== null);
	const body = hoverActions && running ? (
		<SidebarRowHover>
			{row}
			<SidebarRowSpinner label={intl.formatMessage(desktopMessages.chatAgentWorking)} />
		</SidebarRowHover>
	) : showHoverActions ? (
		<SidebarRowHover>
			{row}
			<SidebarRowHoverActions>
				{pinButton}
				{archiveButton}
			</SidebarRowHoverActions>
		</SidebarRowHover>
	) : (
		row
	);

	return (
		<>
			{body}
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
