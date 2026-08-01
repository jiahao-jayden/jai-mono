import type { CodingSession } from "@jai/coding/business";
import {
	Archive,
	ChevronDown,
	Clock3,
	Code2,
	Folder,
	Home,
	MessageCircle,
	Palette,
	PanelLeftClose,
	Plus,
	Search,
	Settings2,
	Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";

interface SidebarProps {
	sessions: readonly CodingSession[];
	runningSessionIds: readonly string[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	onNewChat(): void;
	onSelectSession(sessionId: string): void;
}

const navigation = [
	{ label: "Chats and tasks", icon: MessageCircle },
	{ label: "Projects", icon: Folder },
	{ label: "Artifacts", icon: Archive },
	{ label: "Scheduled", icon: Clock3 },
	{ label: "Customize", icon: Sparkles },
] as const;

export function Sidebar({
	sessions,
	runningSessionIds,
	activeSessionId,
	loading,
	error,
	onNewChat,
	onSelectSession,
}: SidebarProps) {
	const running = new Set(runningSessionIds);

	return (
		<aside className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
			<div className="flex items-center justify-between px-4 pt-3 pb-2">
				<div className="flex rounded-[10px] bg-sidebar-accent p-[3px]">
					<div
						aria-current="page"
						className="flex h-8 items-center gap-2 rounded-lg bg-background px-4 text-[13px] font-semibold shadow-sm"
					>
						<Home size={14} strokeWidth={1.8} />
						Home
					</div>
					<button
						type="button"
						disabled
						title="Code view is coming later"
						className="flex h-8 cursor-not-allowed items-center gap-2 rounded-lg px-4 text-[13px] text-muted-foreground opacity-55"
					>
						<Code2 size={14} strokeWidth={1.8} />
						Code
					</button>
				</div>
				<div className="flex items-center">
					<IconButton label="Search (coming later)">
						<Search size={16} />
					</IconButton>
					<IconButton label="Collapse sidebar (coming later)">
						<PanelLeftClose size={16} />
					</IconButton>
				</div>
			</div>

			<nav aria-label="Primary" className="space-y-0.5 px-2.5">
				<button
					type="button"
					onClick={onNewChat}
					className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium transition-colors hover:bg-sidebar-accent"
				>
					<span className="flex size-[22px] items-center justify-center rounded-full bg-foreground text-background">
						<Plus size={13} strokeWidth={2} />
					</span>
					New
				</button>
				{navigation.map(({ label, icon: Icon }) => (
					<button
						type="button"
						key={label}
						disabled
						title={`${label} is coming later`}
						className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-[13px] py-2 text-left text-[13.5px] text-foreground/55"
					>
						<Icon size={16} strokeWidth={1.6} />
						{label}
					</button>
				))}
			</nav>

			<div className="flex items-center justify-between px-5 pt-5 pb-1.5">
				<span className="text-[12px] font-semibold text-muted-foreground">Recents</span>
				<Settings2 size={13} className="text-muted-foreground" />
			</div>

			<div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
				{loading && sessions.length === 0 ? (
					<div className="space-y-2 px-2.5 py-2" role="status" aria-label="Loading recent sessions">
						{[0, 1, 2].map((item) => (
							<div key={item} className="h-8 animate-pulse rounded-lg bg-foreground/[0.05]" />
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
						<button
							type="button"
							key={session.id}
							onClick={() => onSelectSession(session.id)}
							aria-current={selected ? "page" : undefined}
							className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
								selected ? "bg-sidebar-accent font-semibold" : "text-foreground/80 hover:bg-sidebar-accent"
							}`}
						>
							<span className="relative shrink-0">
								<MessageCircle size={15} strokeWidth={1.6} />
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
						</button>
					);
				})}
			</div>

			<div className="border-t border-sidebar-border px-2.5 py-1">
				<button
					type="button"
					disabled
					title="Design settings are coming later"
					className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-[13px] py-2 text-left text-[13px] text-foreground/55"
				>
					<Palette size={16} strokeWidth={1.6} />
					Design
				</button>
			</div>
			<button
				type="button"
				disabled
				title="Profile settings are coming later"
				className="flex cursor-not-allowed items-center gap-2.5 border-t border-sidebar-border px-4 py-3 text-left"
			>
				<span className="flex size-7 items-center justify-center rounded-full bg-[#31705f] text-[12px] font-semibold text-white">
					J
				</span>
				<span className="flex min-w-0 flex-1 items-center gap-1.5">
					<span className="truncate text-[13.5px] font-semibold">Jiahao</span>
					<span className="text-[13px] text-muted-foreground">· Local</span>
					<ChevronDown size={11} className="shrink-0 text-muted-foreground" />
				</span>
				<span className="size-2 rounded-full bg-primary-2" />
				<span className="sr-only">Local runtime connected</span>
			</button>
		</aside>
	);
}

function IconButton({ label, children }: { label: string; children: ReactNode }) {
	return (
		<button
			type="button"
			disabled
			aria-label={label}
			title={label}
			className="flex size-8 cursor-not-allowed items-center justify-center rounded-lg text-muted-foreground opacity-60"
		>
			{children}
		</button>
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
