import { cn } from "cn";
import { useIntl } from "react-intl";
import { Button } from "@/components/ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import type { DesktopSubagentItem } from "../../../../shared/desktop-rpc";
import { WorkspacePanel } from "../workspace-panel";
import { SubagentPanel } from "./subagent-panel";
import type { DockState, DockTab } from "./use-dock";

interface DockProps {
	readonly sessionId: string;
	readonly dock: DockState;
	readonly subagents: readonly DesktopSubagentItem[];
	readonly selectedSubagentId?: string | null;
}

export function Dock({ sessionId, dock, subagents, selectedSubagentId = null }: DockProps) {
	const intl = useIntl();
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const { activeTab } = dock;
	const entries = [
		{ icon: icons["file-code"], label: intl.formatMessage(desktopMessages.dockFilePanel), open: dock.openFilePanel },
		{ icon: icons.users, label: intl.formatMessage(desktopMessages.dockSubagentPanel), open: dock.openSubagentPanel },
	];

	return (
		<aside
			id="session-dock"
			aria-label={intl.formatMessage(desktopMessages.dockPanels)}
			className="flex h-full w-full min-w-0 flex-col border-l border-[var(--border-surface)]"
		>
			<div
				className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto pr-18 pl-2"
				role="tablist"
				aria-label={intl.formatMessage(desktopMessages.dockPanels)}
			>
				{dock.tabs.map((tab) => (
					<DockTabButton
						key={tab.id}
						tab={tab}
						active={tab.id === activeTab?.id}
						onSelect={() => dock.selectTab(tab.id)}
						onClose={() => dock.closeTab(tab.id)}
					/>
				))}
				<DropdownMenu>
					<DropdownTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={intl.formatMessage(desktopMessages.dockNewPanel)}
								title={intl.formatMessage(desktopMessages.dockNewPanel)}
								className="shrink-0 text-muted-foreground"
							>
								<PlusIcon size={15} />
							</Button>
						}
					/>
					<DropdownContent align="start" className="w-44">
						{entries.map((entry, index) => (
							<MenuItem
								key={entry.label}
								index={index}
								icon={entry.icon}
								label={entry.label}
								onSelect={entry.open}
							/>
						))}
					</DropdownContent>
				</DropdownMenu>
			</div>
			<div className="min-h-0 flex-1">
				{activeTab === null ? (
					<div className="flex h-full flex-col justify-center gap-2 px-8">
						{entries.map((entry) => (
							<Button
								key={entry.label}
								type="button"
								variant="ghost"
								size="md"
								onClick={entry.open}
								leadingIcon={entry.icon}
								className="h-11 w-full justify-start gap-3 rounded-lg px-3 text-[14px] font-normal text-foreground"
								contentClassName="w-full justify-start"
							>
								{entry.label}
							</Button>
						))}
					</div>
				) : activeTab.kind === "subagents" ? (
					<SubagentPanel items={subagents} selectedId={selectedSubagentId} />
				) : (
					<WorkspacePanel sessionId={sessionId} filePath={activeTab.path} onOpenFile={dock.openFile} />
				)}
			</div>
		</aside>
	);
}

function DockTabButton({
	tab,
	active,
	onSelect,
	onClose,
}: {
	readonly tab: DockTab;
	readonly active: boolean;
	onSelect(): void;
	onClose(): void;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const XIcon = icons.x;
	const TabIcon = tab.kind === "subagents" ? icons.users : icons["file-code"];
	const label =
		tab.kind === "subagents"
			? intl.formatMessage(desktopMessages.dockSubagentPanel)
			: (tab.name ?? intl.formatMessage(desktopMessages.workspaceChooseFile));
	const closeLabel = intl.formatMessage(desktopMessages.dockClosePanel, { name: label });

	return (
		<div
			className={cn(
				"group flex h-7 min-w-0 max-w-44 shrink-0 items-center rounded-md pr-0.5 text-[13px] transition-colors duration-150",
				active
					? "bg-surface-primary text-foreground shadow-[0_0_0_var(--hairline)_var(--border-surface),0_1px_2px_-1px_rgb(0_0_0/.08)]"
					: "text-muted-foreground hover:bg-muted-hover hover:text-foreground",
			)}
		>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				role="tab"
				aria-selected={active}
				onClick={onSelect}
				className="h-7 min-w-0 flex-1 rounded-md px-2 text-inherit hover:text-inherit [&>span:first-child]:bg-transparent!"
				contentClassName="min-w-0"
				labelClassName="flex min-w-0 items-center gap-1.5"
			>
				<TabIcon size={13} className="shrink-0" />
				<span className="truncate">{label}</span>
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={closeLabel}
				title={closeLabel}
				onClick={onClose}
				className="shrink-0 rounded-sm text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
			>
				<XIcon size={11} />
			</Button>
		</div>
	);
}
