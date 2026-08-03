import type { CodingSession } from "@jai/coding/business";
import { type MotionValue, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../ui/button";

const drag = { WebkitAppRegion: "drag" } as CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

interface SidebarProps {
	sessions: readonly CodingSession[];
	runningSessionIds: readonly string[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	width?: MotionValue<number>;
	settingsDisabled: boolean;
	onToggleSidebar(): void;
	onNewChat(): void;
	onOpenSettings(): void;
	onSelectSession(sessionId: string): void;
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
	runningSessionIds,
	activeSessionId,
	loading,
	error,
	width,
	settingsDisabled,
	onToggleSidebar,
	onNewChat,
	onOpenSettings,
	onSelectSession,
}: SidebarProps) {
	const running = new Set(runningSessionIds);
	const icons = useIcons();
	const SearchIcon = icons.search;
	const PanelLeftCloseIcon = icons["panel-left-close"];
	const PlusIcon = icons.plus;
	const SettingsIcon = icons.settings;
	const MessageIcon = icons["message-circle"];

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

			<div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
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
						<Button
							type="button"
							variant="navigation"
							size="md"
							key={session.id}
							onClick={() => onSelectSession(session.id)}
							aria-current={selected ? "page" : undefined}
							active={selected}
							className={`h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${
								selected ? "font-semibold" : "text-foreground/80"
							}`}
						>
							<span className="flex min-w-0 w-full items-center gap-2.5">
								<span className="relative shrink-0">
									<MessageIcon size={15} strokeWidth={1.5} />
									{running.has(session.id) ? (
										<>
											<span className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-primary-2 ring-2 ring-sidebar" />
											<span className="sr-only">Running</span>
										</>
									) : null}
								</span>
								<span className="min-w-0 flex-1 truncate">{session.title}</span>
								<span className="shrink-0 text-[10.5px] font-normal text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
									{relativeTime(session.lastActivityAt)}
								</span>
							</span>
						</Button>
					);
				})}
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

function relativeTime(timestamp: number): string {
	const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}
