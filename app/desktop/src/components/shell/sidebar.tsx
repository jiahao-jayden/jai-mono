import type { CodingSession } from "@jai/coding/business";
import { type MotionValue, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

interface SidebarProps {
	sessions: readonly CodingSession[];
	runningSessionIds: readonly string[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	width?: MotionValue<number>;
	settingsDisabled: boolean;
	onToggleSidebar(): void;
	onNewChat(): void;
	onOpenSettings(): void;
	onSelectSession(sessionId: string): void;
	onLoadMore?(): void;
}

const navigation = [
	{ label: "Chats and tasks", icon: "message-circle" },
	{ label: "Projects", icon: "folder" },
	{ label: "Artifacts", icon: "archive" },
	{ label: "Scheduled", icon: "clock" },
	{ label: "Customize", icon: "sparkles" },
] as const;

export function Sidebar({
	sessions,
	activeSessionId,
	loading,
	error,
	hasNextPage = false,
	loadingMore = false,
	width,
	settingsDisabled,
	onToggleSidebar,
	onNewChat,
	onOpenSettings,
	onSelectSession,
	onLoadMore,
}: SidebarProps) {
	const icons = useIcons();
	const SearchIcon = icons.search;
	const PanelLeftCloseIcon = icons["panel-left-close"];
	const PlusIcon = icons.plus;
	const SettingsIcon = icons.settings;
	const MoreVerticalIcon = icons["more-vertical"];

	return (
		<motion.aside
			className="flex h-full w-66 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
			style={width ? { width } : undefined}
		>
			<div className="flex h-13 shrink-0 items-center justify-end px-3" style={drag}>
				<div className="flex items-center gap-1" style={noDrag}>
					<Button
						type="button"
						variant="navigation"
						size="icon-sm"
						onClick={onToggleSidebar}
						aria-label="Collapse sidebar"
						title="Collapse sidebar"
						className="size-7.5 rounded-[7px] text-muted-foreground/60 hover:text-muted-foreground"
					>
						<PanelLeftCloseIcon size={16} className="rotate-180" />
					</Button>
					<IconButton label="Search (coming later)">
						<SearchIcon size={16} />
					</IconButton>
				</div>
			</div>

			<nav aria-label="Primary" className="space-y-0.5 px-2.5">
				<Button
					type="button"
					variant="navigation"
					size="md"
					onClick={onNewChat}
					className="w-full justify-start gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground"
				>
					<span className="flex items-center gap-3">
						<span className="flex size-5.5 items-center justify-center rounded-full bg-foreground text-background">
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
							<Button
								type="button"
								variant="navigation"
								size="icon-sm"
								aria-disabled="true"
								tabIndex={-1}
								aria-label="Session actions (coming later)"
								title="Session actions (coming later)"
								className={cn(
									"absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-lg text-foreground/50 transition-opacity hover:text-foreground/80",
									selected
										? "visible opacity-100"
										: "invisible opacity-0 group-hover:visible group-hover:opacity-100",
								)}
							>
								<MoreVerticalIcon size={16} strokeWidth={1.5} />
							</Button>
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
		</motion.aside>
	);
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Button
			type="button"
			variant="navigation"
			size="icon-sm"
			aria-disabled="true"
			tabIndex={-1}
			aria-label={label}
			title={label}
			className="size-7.5 cursor-default rounded-[7px] text-muted-foreground/60 hover:text-muted-foreground"
		>
			{children}
		</Button>
	);
}
