import type { CodingSession } from "@jai/coding/business";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { Button } from "../../ui/button";

interface SidebarRecentsProps {
	sessions: readonly CodingSession[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	onSelectSession(sessionId: string): void;
	onLoadMore?(): void;
}

export function SidebarRecents({
	sessions,
	activeSessionId,
	loading,
	error,
	hasNextPage = false,
	loadingMore = false,
	onSelectSession,
	onLoadMore,
}: SidebarRecentsProps) {
	const icons = useIcons();
	const MoreVerticalIcon = icons["more-vertical"];

	return (
		<>
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
		</>
	);
}
