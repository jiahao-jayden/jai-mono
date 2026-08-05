import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";

const navigation = [
	{ label: "Chats and tasks", icon: "message-circle" },
	{ label: "Projects", icon: "folder" },
	{ label: "Artifacts", icon: "archive" },
	{ label: "Scheduled", icon: "clock" },
	{ label: "Customize", icon: "sparkles" },
] as const;

interface SidebarNavProps {
	onNewChat(): void;
}

export function SidebarNav({ onNewChat }: SidebarNavProps) {
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
			{navigation.map(({ label, icon }) => {
				const Icon = icons[icon];
				return (
					<Button
						type="button"
						variant="navigation"
						size="md"
						key={label}
						aria-disabled="true"
						tabIndex={-1}
						title={`${label} is coming later`}
						leadingIcon={Icon}
						className="h-auto w-full cursor-default justify-start gap-3 rounded-lg px-3.25 py-2 text-left text-[13.5px] text-foreground/60 hover:text-foreground/75"
					>
						{label}
					</Button>
				);
			})}
		</nav>
	);
}
