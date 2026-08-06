import type { CodingSession } from "@jai/coding/business";
import { format, formatDistanceToNow } from "date-fns";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopProject } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface ProjectsPageProps {
	readonly projects: readonly DesktopProject[];
	readonly sessions: readonly CodingSession[];
	readonly loading: boolean;
	readonly error?: string;
	readonly adding: boolean;
	readonly onAddProject: () => void;
	readonly onOpenProject: (project: DesktopProject) => void;
}

export function ProjectsPage({
	projects,
	sessions,
	loading,
	error,
	adding,
	onAddProject,
	onOpenProject,
}: ProjectsPageProps) {
	const icons = useIcons();
	const SearchIcon = icons.search;
	const FolderIcon = icons.folder;
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<"updated" | "name">("updated");
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const emptyTitle = normalizedQuery ? "没有匹配的项目" : "还没有项目";
	const emptyDescription = normalizedQuery
		? "可以按项目名或本地路径搜索。"
		: "选择一个本地目录，让 agent 在清晰的边界里工作。";
	const projectStats = useMemo(() => {
		const stats = new Map<string, { count: number; latestActivity: number }>();
		for (const session of sessions) {
			if (!session.projectId) continue;
			const current = stats.get(session.projectId);
			stats.set(session.projectId, {
				count: (current?.count ?? 0) + 1,
				latestActivity: Math.max(current?.latestActivity ?? 0, session.lastActivityAt),
			});
		}
		return stats;
	}, [sessions]);
	const visibleProjects = projects
		.filter(
			(project) =>
				!normalizedQuery ||
				project.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
				project.path.toLocaleLowerCase().includes(normalizedQuery),
		)
		.toSorted((left, right) => {
			if (sort === "name") return left.displayName.localeCompare(right.displayName);
			const leftActivity = projectStats.get(left.id)?.latestActivity ?? left.updatedAt;
			const rightActivity = projectStats.get(right.id)?.latestActivity ?? right.updatedAt;
			return rightActivity - leftActivity || left.displayName.localeCompare(right.displayName);
		});

	return (
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
			<div className="mx-auto flex h-full w-full max-w-250 flex-col px-10 pt-14 pb-8">
				<header className="mb-8 flex shrink-0 items-center justify-between gap-6">
					<div>
						<h1 className="text-[26px] font-semibold tracking-[-0.025em]">Projects</h1>
						<p className="mt-1 text-[13px] text-muted-foreground">本地目录与它们持续积累的工作上下文。</p>
					</div>
					<div className="flex items-center gap-2">
						<div className="relative w-52">
							<SearchIcon
								size={15}
								className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search projects"
								aria-label="Search projects"
								className="h-8 border-border bg-transparent pr-3 pl-9"
							/>
						</div>
						<Button
							type="button"
							variant="tertiary"
							size="md"
							onClick={() => setSort((current) => (current === "updated" ? "name" : "updated"))}
							trailingIcon={icons["chevron-down"]}
							aria-label="Change project sort"
						>
							{sort === "updated" ? "Last updated" : "Name"}
						</Button>
						<Button
							type="button"
							variant="primary"
							size="md"
							loading={adding}
							onClick={onAddProject}
							leadingIcon={icons.plus}
						>
							New project
						</Button>
					</div>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading && projects.length === 0 ? <ProjectGridSkeleton /> : null}
					{error ? (
						<div className="rounded-xl bg-destructive/8 px-4 py-3 text-[13px] text-destructive" role="alert">
							Projects 暂时无法加载。请重新打开此页面。
						</div>
					) : null}
					{!loading && !error && visibleProjects.length === 0 ? (
						<div className="flex min-h-72 flex-col items-center justify-center text-center">
							<FolderIcon size={27} className="mb-3 text-muted-foreground/55" />
							<p className="text-[14px] font-medium">{emptyTitle}</p>
							<p className="mt-1 max-w-80 text-[12.5px] leading-relaxed text-muted-foreground">
								{emptyDescription}
							</p>
							{!normalizedQuery ? (
								<Button
									type="button"
									variant="secondary"
									size="md"
									loading={adding}
									onClick={onAddProject}
									leadingIcon={icons.plus}
									className="mt-5"
								>
									Add local folder
								</Button>
							) : null}
						</div>
					) : null}
					{visibleProjects.length > 0 ? (
						<div className="grid grid-cols-2 gap-4">
							{visibleProjects.map((project) => {
								const stats = projectStats.get(project.id);
								const latestActivity = stats?.latestActivity ?? project.updatedAt;
								const sessionCount = stats?.count ?? 0;
								const availabilityLabel = project.available ? "Available" : "Folder unavailable";
								return (
									<Button
										key={project.id}
										type="button"
										variant="ghost"
										onClick={() => onOpenProject(project)}
										contentClassName="h-full w-full"
										labelClassName="h-full w-full [text-box:normal]"
										className="h-30 justify-start rounded-[14px] border border-border/80 px-5 py-4 text-left hover:border-foreground/15"
									>
										<span className="flex h-full w-full min-w-0 flex-col justify-between">
											<span className="flex min-w-0 items-start justify-between gap-4">
												<span className="min-w-0">
													<span className="block truncate text-[14px] font-semibold text-foreground">
														{project.displayName}
													</span>
													<span className="mt-1 block truncate font-mono text-[10.5px] text-muted-foreground">
														{project.path}
													</span>
												</span>
												<span
													className={cn(
														"mt-1 size-1.5 shrink-0 rounded-full",
														project.available ? "bg-primary-2" : "bg-destructive",
													)}
													aria-hidden="true"
												/>
												<span className="sr-only">{availabilityLabel}</span>
											</span>
											<span className="flex items-center justify-between text-[11.5px] text-muted-foreground">
												<span>{sessionCount === 1 ? "1 chat" : `${sessionCount} chats`}</span>
												<time dateTime={new Date(latestActivity).toISOString()}>
													{formatProjectTime(latestActivity)}
												</time>
											</span>
										</span>
									</Button>
								);
							})}
						</div>
					) : null}
				</div>
			</div>
		</main>
	);
}

interface ProjectPageProps {
	readonly project: DesktopProject;
	readonly sessions: readonly CodingSession[];
	readonly composer: ReactNode;
	readonly onBack: () => void;
	readonly onSelectSession: (sessionId: string) => void;
}

export function ProjectPage({ project, sessions, composer, onBack, onSelectSession }: ProjectPageProps) {
	const icons = useIcons();
	const MessageIcon = icons["message-circle"];
	const projectSessions = sessions.filter((session) => session.projectId === project.id);
	const availabilityLabel = project.available ? "Available" : "Folder unavailable";

	return (
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
			<div className="mx-auto flex h-full w-full max-w-250 flex-col px-10 pt-8 pb-8">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onBack}
					leadingIcon={icons["arrow-left"]}
					className="mb-6 w-fit px-1 text-muted-foreground"
				>
					All projects
				</Button>
				<header className="mb-7 flex items-start justify-between gap-6">
					<div className="min-w-0">
						<div className="flex items-center gap-2.5">
							<h1 className="truncate text-[25px] font-semibold tracking-[-0.025em]">{project.displayName}</h1>
							<span
								className={cn(
									"size-1.5 shrink-0 rounded-full",
									project.available ? "bg-primary-2" : "bg-destructive",
								)}
								aria-hidden="true"
							/>
							<span className="sr-only">{availabilityLabel}</span>
						</div>
						<p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{project.path}</p>
					</div>
				</header>

				<div className="mb-7 shrink-0">{composer}</div>

				<section className="min-h-0 flex-1">
					<h2 className="mb-3 text-[12px] font-semibold text-muted-foreground">Recents</h2>
					<div className="h-[calc(100%-28px)] overflow-y-auto border-y border-border/70">
						{projectSessions.length === 0 ? (
							<div className="flex min-h-40 flex-col items-center justify-center text-center">
								<MessageIcon size={22} className="mb-2.5 text-muted-foreground/50" />
								<p className="text-[13px] font-medium">这个项目还没有对话</p>
								<p className="mt-1 text-[12px] text-muted-foreground">从上面的输入框开始第一项工作。</p>
							</div>
						) : (
							<div className="divide-y divide-border/70">
								{projectSessions.map((session) => (
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
											<MessageIcon size={14} className="shrink-0 text-muted-foreground/70" />
											<span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">
												{session.title}
											</span>
											<time
												dateTime={new Date(session.lastActivityAt).toISOString()}
												className="min-w-28 shrink-0 whitespace-nowrap text-right text-[11.5px] text-muted-foreground"
											>
												{formatProjectTime(session.lastActivityAt)}
											</time>
										</span>
									</Button>
								))}
							</div>
						)}
					</div>
				</section>
			</div>
		</main>
	);
}

function ProjectGridSkeleton() {
	return (
		<div className="grid grid-cols-2 gap-4" role="status" aria-label="Loading projects">
			{[0, 1, 2, 3].map((item) => (
				<div key={item} className="h-30 animate-pulse rounded-[14px] border border-border/60 bg-foreground/3" />
			))}
		</div>
	);
}

function formatProjectTime(timestamp: number): string {
	const date = new Date(timestamp);
	const age = Date.now() - timestamp;
	return age < 7 * 24 * 60 * 60 * 1000 ? formatDistanceToNow(date, { addSuffix: true }) : format(date, "MMM d");
}
