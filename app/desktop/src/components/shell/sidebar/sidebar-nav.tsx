import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { Button } from "../../ui/button";

const navigation = [
	{ id: "chats", message: desktopMessages.sidebarChats, icon: "message-circle", available: true },
	{ id: "projects", message: desktopMessages.sidebarProjects, icon: "folder", available: true },
] as const;

export const sidebarItemClassName =
	"h-[30px] w-full justify-start gap-2 rounded-lg px-2 text-left text-[13px] font-normal text-sidebar-foreground";

interface SidebarNavProps {
	activeView: "chat" | "chats" | "projects" | "project" | "settings";
	onNewChat(): void;
	onOpenChats(): void;
	onOpenProjects(): void;
}

export function SidebarNav({ activeView, onNewChat, onOpenChats, onOpenProjects }: SidebarNavProps) {
	const intl = useIntl();
	const icons = useIcons();

	return (
		<nav aria-label={intl.formatMessage(desktopMessages.sidebarPrimary)} className="space-y-0.5 px-1.5 pt-1.5">
			<Button
				type="button"
				variant="navigation"
				size="md"
				onClick={onNewChat}
				leadingIcon={icons.pencil}
				className={sidebarItemClassName}
			>
				{intl.formatMessage(desktopMessages.sidebarNew)}
			</Button>
			{navigation.map(({ id, message, icon }) => {
				const Icon = icons[icon];
				const label = intl.formatMessage(message);
				const active = activeView === id;
				const onClick = id === "chats" ? onOpenChats : id === "projects" ? onOpenProjects : undefined;
				const ariaCurrent = active ? ("page" as const) : undefined;
				const navigationClassName = cn(sidebarItemClassName, {
					"shadow-[0_0_0_.5px_rgb(0_0_0/.05)]": active,
				});
				return (
					<Button
						type="button"
						variant="navigation"
						size="md"
						key={id}
						active={active}
						aria-current={ariaCurrent}
						onClick={onClick}
						leadingIcon={Icon}
						className={navigationClassName}
					>
						{label}
					</Button>
				);
			})}
		</nav>
	);
}
