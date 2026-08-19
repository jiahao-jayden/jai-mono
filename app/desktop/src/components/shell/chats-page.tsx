import { format, formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { useIcons } from "@/lib/icon-context";
import type { CodingSession, DesktopProject } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface ChatsPageProps {
	readonly sessions: readonly CodingSession[];
	readonly projects: readonly DesktopProject[];
	readonly loading: boolean;
	readonly error?: string;
	readonly hasNextPage: boolean;
	readonly loadingMore: boolean;
	readonly onNewChat: () => void;
	readonly onSelectSession: (sessionId: string) => void;
	readonly onLoadMore: () => void;
}

export function ChatsPage({
	sessions,
	projects,
	loading,
	error,
	hasNextPage,
	loadingMore,
	onNewChat,
	onSelectSession,
	onLoadMore,
}: ChatsPageProps) {
	const icons = useIcons();
	const SearchIcon = icons.search;
	const MessageIcon = icons["message-circle"];
	const [query, setQuery] = useState("");
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const emptyTitle = normalizedQuery ? "没有匹配的对话" : "还没有对话";
	const emptyDescription = normalizedQuery ? "换一个关键词试试。" : "新对话会保存在这里，随时可以继续。";
	const projectNames = useMemo(
		() => new Map(projects.map((project) => [project.id, project.displayName])),
		[projects],
	);
	const filteredSessions = normalizedQuery
		? sessions.filter((session) => {
				const projectName = session.projectId ? projectNames.get(session.projectId) : undefined;
				return (
					session.title.toLocaleLowerCase().includes(normalizedQuery) ||
					projectName?.toLocaleLowerCase().includes(normalizedQuery)
				);
			})
		: sessions;

	return (
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
			<div className="mx-auto flex h-full w-full max-w-250 flex-col px-10 pt-14 pb-8">
				<header className="mb-8 flex shrink-0 items-center justify-between gap-6">
					<div>
						<h1 className="text-[26px] font-semibold tracking-[-0.025em]">Chats</h1>
						<p className="mt-1 text-[13px] text-muted-foreground">继续最近的对话，或把一个新任务交给 agent。</p>
					</div>
					<div className="flex items-center gap-2">
						<div className="relative w-56">
							<SearchIcon
								size={15}
								className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search chats"
								aria-label="Search chats"
								className="h-8 border-border bg-transparent pr-3 pl-9"
							/>
						</div>
						<Button type="button" variant="primary" size="md" onClick={onNewChat} leadingIcon={icons.plus}>
							New chat
						</Button>
					</div>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading && sessions.length === 0 ? <ChatRowsSkeleton /> : null}
					{error ? (
						<div className="rounded-xl bg-destructive/8 px-4 py-3 text-[13px] text-destructive" role="alert">
							Chats 暂时无法加载。请稍后重试。
						</div>
					) : null}
					{!loading && !error && filteredSessions.length === 0 ? (
						<div className="flex min-h-72 flex-col items-center justify-center text-center">
							<MessageIcon size={25} className="mb-3 text-muted-foreground/55" />
							<p className="text-[14px] font-medium">{emptyTitle}</p>
							<p className="mt-1 max-w-72 text-[12.5px] leading-relaxed text-muted-foreground">
								{emptyDescription}
							</p>
						</div>
					) : null}
					{filteredSessions.length > 0 ? (
						<div className="divide-y divide-border/70 border-y border-border/70">
							{filteredSessions.map((session) => {
								const projectName = session.projectId ? projectNames.get(session.projectId) : undefined;
								return (
									<Button
										key={session.id}
										type="button"
										variant="ghost"
										size="md"
										onClick={() => onSelectSession(session.id)}
										contentClassName="w-full min-w-0"
										labelClassName="w-full min-w-0 [text-box:normal]"
										className="h-11 w-full rounded-none px-3 text-left"
									>
										<span className="flex w-full min-w-0 items-center gap-4">
											<span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">
												{session.title}
											</span>
											{projectName ? (
												<span className="max-w-32 truncate text-[11.5px] text-muted-foreground">
													{projectName}
												</span>
											) : null}
											<time
												dateTime={new Date(session.lastActivityAt).toISOString()}
												className="min-w-28 shrink-0 whitespace-nowrap text-right text-[11.5px] text-muted-foreground"
											>
												{formatSessionTime(session.lastActivityAt)}
											</time>
										</span>
									</Button>
								);
							})}
						</div>
					) : null}
					{hasNextPage && !normalizedQuery ? (
						<div className="pt-4 text-center">
							<Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={onLoadMore}>
								Load more
							</Button>
						</div>
					) : null}
				</div>
			</div>
		</main>
	);
}

function ChatRowsSkeleton() {
	return (
		<div className="divide-y divide-border/60 border-y border-border/60" role="status" aria-label="Loading chats">
			{[0, 1, 2, 3, 4].map((item) => (
				<div key={item} className="flex h-11 items-center justify-between px-3">
					<div className="h-3 w-2/5 animate-pulse rounded bg-foreground/7" />
					<div className="h-3 w-16 animate-pulse rounded bg-foreground/5" />
				</div>
			))}
		</div>
	);
}

function formatSessionTime(timestamp: number): string {
	const date = new Date(timestamp);
	const age = Date.now() - timestamp;
	return age < 7 * 24 * 60 * 60 * 1000 ? formatDistanceToNow(date, { addSuffix: true }) : format(date, "MMM d");
}
