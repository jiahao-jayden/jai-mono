import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";

interface SidebarFooterProps {
	settingsDisabled: boolean;
	onOpenSettings(): void;
}

export function SidebarFooter({ settingsDisabled, onOpenSettings }: SidebarFooterProps) {
	const icons = useIcons();
	const SettingsIcon = icons.settings;

	return (
		<div className="shrink-0 border-t border-sidebar-border px-2.5 py-2">
			<Button
				type="button"
				variant="navigation"
				size="md"
				leadingIcon={SettingsIcon}
				onClick={onOpenSettings}
				disabled={settingsDisabled}
				title={settingsDisabled ? "Wait for the current run to finish" : "Settings (⌘,)"}
				className="w-full justify-start gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] text-foreground/75"
			>
				Settings
			</Button>
		</div>
	);
}
