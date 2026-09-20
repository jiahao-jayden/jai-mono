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
import type { DesktopProject } from "../../../shared/desktop-rpc";
import { toast } from "../ui/toast";
import { SidebarHoverIconButton, SidebarRowHover, SidebarRowHoverActions } from "./sidebar/sidebar-row-hover";

export function projectContextMenuItems(
	project: Pick<DesktopProject, "available">,
	labels: { readonly reveal: string; readonly copyPath: string; readonly relink: string },
): NativeMenuDescriptor[] {
	if (project.available) {
		return [
			{ id: "reveal", label: labels.reveal, icon: "folder-open" },
			{ id: "copy-path", label: labels.copyPath, icon: "copy" },
		];
	}
	return [
		{ id: "copy-path", label: labels.copyPath, icon: "copy" },
		{ id: "relink", label: labels.relink, icon: "link" },
	];
}

export function ProjectActions({
	project,
	onRelink,
	onReveal,
	onNewChat,
	children,
}: {
	readonly project: DesktopProject;
	readonly onRelink: (project: DesktopProject) => Promise<void>;
	readonly onReveal: (project: DesktopProject) => Promise<void>;
	readonly onNewChat?: (project: DesktopProject) => void;
	readonly children: ReactNode;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const MoreIcon = icons.dot;
	const NewChatIcon = icons.pencil;
	const [pending, setPending] = useState(false);
	const menuOpenRef = useRef(false);
	const actionsLabel = intl.formatMessage(desktopMessages.sidebarActionsFor, { title: project.displayName });
	const newChatLabel = intl.formatMessage(desktopMessages.sidebarNewChat);

	const copyPath = async () => {
		try {
			await navigator.clipboard.writeText(project.path);
			toast.add({ title: intl.formatMessage(desktopMessages.commonCopied), type: "success" });
		} catch {
			toast.add({ title: intl.formatMessage(desktopMessages.commonCopyFailed), type: "error" });
		}
	};
	const reveal = async () => {
		if (pending) return;
		setPending(true);
		try {
			await onReveal(project);
		} catch {
			toast.add({ title: intl.formatMessage(desktopMessages.sidebarRevealFailed), type: "error" });
		} finally {
			setPending(false);
		}
	};
	const relink = async () => {
		if (pending) return;
		setPending(true);
		try {
			await onRelink(project);
		} catch {
			toast.add({ title: intl.formatMessage(desktopMessages.projectsLoadError), type: "error" });
		} finally {
			setPending(false);
		}
	};

	const popup = async (position: { x: number; y: number }) => {
		if (pending || menuOpenRef.current) return;
		menuOpenRef.current = true;
		try {
			const id = await showNativeMenu(
				projectContextMenuItems(project, {
					reveal: intl.formatMessage(desktopMessages.sidebarRevealInFinder),
					copyPath: intl.formatMessage(desktopMessages.sidebarCopyPath),
					relink: intl.formatMessage(desktopMessages.sidebarRelink),
				}),
				position,
			);
			if (id === "reveal") await reveal();
			if (id === "copy-path") await copyPath();
			if (id === "relink") await relink();
		} catch {
			// The native menu is best-effort.
		} finally {
			menuOpenRef.current = false;
		}
	};

	const openMenu = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		await popup(nativeMenuAnchor(event));
	};

	const openMenuFromButton = async (event: MouseEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		await popup({ x: Math.round(rect.left), y: Math.round(rect.bottom + 4) });
	};

	const row = isValidElement(children)
		? cloneElement(children as ReactElement<{ onContextMenu?: (event: MouseEvent) => void }>, {
				onContextMenu: (event) => void openMenu(event),
			})
		: children;
	const newChatButton =
		onNewChat && project.available ? (
			<SidebarHoverIconButton
				label={newChatLabel}
				onClick={() => onNewChat(project)}
				onContextMenu={(event) => void openMenu(event)}
			>
				<NewChatIcon size={15} strokeWidth={1.5} />
			</SidebarHoverIconButton>
		) : null;

	return (
		<SidebarRowHover>
			{row}
			<SidebarRowHoverActions>
				<SidebarHoverIconButton
					label={actionsLabel}
					onClick={(event) => void openMenuFromButton(event)}
					onContextMenu={(event) => void openMenu(event)}
				>
					<MoreIcon size={15} strokeWidth={1.5} />
				</SidebarHoverIconButton>
				{newChatButton}
			</SidebarRowHoverActions>
		</SidebarRowHover>
	);
}
