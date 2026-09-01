import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";

const navigation = [
	{ id: "chats", label: "Chats", icon: "message-circle", available: true },
	{ id: "projects", label: "Projects", icon: "folder", available: true },
] as const;

interface SidebarNavProps {
	activeView: "chat" | "chats" | "projects" | "project";
	onNewChat(): void;
	onOpenChats(): void;
	onOpenProjects(): void;
}

export function SidebarNav({ activeView, onNewChat, onOpenChats, onOpenProjects }: SidebarNavProps) {
	const icons = useIcons();
	const PlusIcon = icons.plus;

	return (
		<nav aria-label="Primary" className="space-y-0.5 px-2.5">
			<Button
				type="button"
				variant="navigation"
				size="md"
				onClick={onNewChat}
				className="w-full justify-start gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground"
			>
				<span className="flex items-center gap-3">
					<span className="flex size-5.5 items-center justify-center rounded-full bg-foreground/8 text-foreground/80">
						<PlusIcon size={13} strokeWidth={2} />
					</span>
					New
				</span>
			</Button>
			{navigation.map(({ id, label, icon }) => {
				const Icon = icons[icon];
				const active = activeView === id;
				const onClick = id === "chats" ? onOpenChats : id === "projects" ? onOpenProjects : undefined;
				const ariaCurrent = active ? ("page" as const) : undefined;
				const navigationClassName =
					"h-auto w-full justify-start gap-3 rounded-lg px-3.25 py-2 text-left text-[13.5px]";
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
