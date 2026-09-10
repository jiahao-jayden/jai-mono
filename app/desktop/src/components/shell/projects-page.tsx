import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { type IntlShape, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { cn } from "cn";
import type { CodingSession, DesktopProject } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CreateProjectDialog } from "./create-project-dialog";

interface ProjectsPageProps {
	readonly projects: readonly DesktopProject[];
	readonly sessions: readonly CodingSession[];
	readonly loading: boolean;
	readonly error?: string;
	readonly onOpenProject: (project: DesktopProject) => void;
}

export function ProjectsPage({ projects, sessions, loading, error, onOpenProject }: ProjectsPageProps) {
	const intl = useIntl();
	const icons = useIcons();
	const [creating, setCreating] = useState(false);
	const SearchIcon = icons.search;
	const FolderIcon = icons.folder;
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<"updated" | "name">("updated");
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const emptyTitle = intl.formatMessage(
		normalizedQuery ? desktopMessages.projectsNoMatch : desktopMessages.projectsEmpty,
	);
	const emptyDescription = normalizedQuery
		? intl.formatMessage(desktopMessages.projectsSearchDescription)
		: intl.formatMessage(desktopMessages.projectsEmptyDescription);
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
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
			<div className="mx-auto flex h-full w-full max-w-250 flex-col px-6 pt-3 pb-8">
				<header className="my-3.5 flex h-8 shrink-0 items-center justify-between gap-4 px-2">
					<h1 className="text-[14px] font-medium text-foreground">
						{intl.formatMessage(desktopMessages.projectsTitle)}
					</h1>
					<div className="flex items-center gap-2">
						<div className="relative w-52">
							<SearchIcon
								size={15}
								className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={intl.formatMessage(desktopMessages.projectsSearch)}
								aria-label={intl.formatMessage(desktopMessages.projectsSearch)}
								className="h-8 border-border bg-transparent pr-3 pl-9"
							/>
						</div>
						<Button
							type="button"
							variant="tertiary"
							size="md"
							onClick={() => setSort((current) => (current === "updated" ? "name" : "updated"))}
							trailingIcon={icons["chevron-down"]}
							aria-label={intl.formatMessage(desktopMessages.projectsSort)}
						>
							{intl.formatMessage(
								sort === "updated" ? desktopMessages.projectsLastUpdated : desktopMessages.projectsName,
							)}
						</Button>
						<Button
							type="button"
							variant="primary"
							size="md"
							onClick={() => setCreating(true)}
							leadingIcon={icons.plus}
						>
							{intl.formatMessage(desktopMessages.projectsNew)}
						</Button>
					</div>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading && projects.length === 0 ? <ProjectGridSkeleton /> : null}
					{error ? (
						<div className="rounded-xl bg-destructive/8 px-4 py-3 text-[13px] text-destructive" role="alert">
							{intl.formatMessage(desktopMessages.projectsPageLoadError)}
						</div>
					) : null}
					{!loading && !error && visibleProjects.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-10 text-center">
							<FolderIcon size={27} className="mb-3 text-muted-foreground/55" />
							<p className="text-[14px] font-medium text-foreground">{emptyTitle}</p>
							<p className="mt-1 max-w-80 text-[13px] leading-relaxed text-muted-foreground">
								{emptyDescription}
							</p>
							{!normalizedQuery ? (
								<Button
									type="button"
									variant="secondary"
									size="md"
									onClick={() => setCreating(true)}
									leadingIcon={icons.plus}
									className="mt-5"
								>
									{intl.formatMessage(desktopMessages.projectCreateStart)}
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
								const availabilityLabel = intl.formatMessage(
									project.available
										? desktopMessages.projectsAvailable
										: desktopMessages.projectsFolderUnavailable,
								);
								return (
									<Button
										key={project.id}
										type="button"
										variant="ghost"
										onClick={() => onOpenProject(project)}
										contentClassName="h-full w-full"
										labelClassName="h-full w-full [text-box:normal]"
										className="min-h-30 justify-start rounded-xl bg-surface-primary px-5 py-4 text-left shadow-[0_0_0_.5px_var(--border-surface)] transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-[0_0_0_.5px_var(--border-surface-strong),0_4px_12px_-4px_rgb(0_0_0/.12)]"
									>
										<span className="flex h-full w-full min-w-0 flex-col justify-between gap-2">
											<span className="flex min-w-0 items-start justify-between gap-4">
												<span className="min-w-0">
													<span className="block truncate text-[14px] font-medium text-surface-primary-foreground">
														{project.displayName}
													</span>
													<span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
														{project.path}
													</span>
												</span>
												<span
													className={cn(
														"mt-1 size-1.5 shrink-0 rounded-full",
														project.available ? "bg-success" : "bg-destructive",
													)}
													aria-hidden="true"
												/>
												<span className="sr-only">{availabilityLabel}</span>
											</span>
											<span className="flex items-center justify-between text-[12px] font-medium text-muted-foreground">
												<span>
													{intl.formatMessage(desktopMessages.projectsChatCount, { count: sessionCount })}
												</span>
												<time dateTime={new Date(latestActivity).toISOString()}>
													{formatProjectTime(latestActivity, intl)}
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
			<CreateProjectDialog open={creating} onOpenChange={setCreating} onCreated={onOpenProject} />
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
	const intl = useIntl();
	const icons = useIcons();
	const MessageIcon = icons["message-circle"];
	const projectSessions = sessions.filter((session) => session.projectId === project.id);
	const availabilityLabel = intl.formatMessage(
		project.available ? desktopMessages.projectsAvailable : desktopMessages.projectsFolderUnavailable,
	);

	return (
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
			<div className="mx-auto flex h-full w-full max-w-250 flex-col px-6 pt-3 pb-8">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={onBack}
					leadingIcon={icons["arrow-left"]}
					className="my-3.5 w-fit px-2 text-muted-foreground"
				>
					{intl.formatMessage(desktopMessages.projectsAll)}
				</Button>
				<header className="mb-6 flex items-start justify-between gap-6 px-2">
					<div className="min-w-0">
						<div className="flex items-center gap-2.5">
							<h1 className="truncate text-[20px] font-medium tracking-[-0.025em] text-foreground">
								{project.displayName}
							</h1>
							<span
								className={cn(
									"size-1.5 shrink-0 rounded-full",
									project.available ? "bg-success" : "bg-destructive",
								)}
								aria-hidden="true"
							/>
							<span className="sr-only">{availabilityLabel}</span>
						</div>
						<p className="mt-1 truncate font-mono text-[12px] text-muted-foreground">{project.path}</p>
					</div>
				</header>

				<div className="mb-6 shrink-0">{composer}</div>

				<section className="min-h-0 flex-1">
					<h2 className="mb-2 px-2 text-[12px] font-medium text-muted-foreground">
						{intl.formatMessage(desktopMessages.projectsRecents)}
					</h2>
					<div className="h-[calc(100%-28px)] overflow-y-auto">
						{projectSessions.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-10 text-center">
								<MessageIcon size={22} className="mb-2.5 text-muted-foreground/50" />
								<p className="text-[14px] font-medium text-foreground">
									{intl.formatMessage(desktopMessages.projectsNoChats)}
								</p>
								<p className="mt-1 text-[13px] text-muted-foreground">
									{intl.formatMessage(desktopMessages.projectsStartChat)}
								</p>
							</div>
						) : (
							<div className="flex flex-col">
								{projectSessions.map((session) => (
									<Button
										key={session.id}
										type="button"
										variant="ghost"
										size="md"
										onClick={() => onSelectSession(session.id)}
										contentClassName="w-full min-w-0"
										labelClassName="w-full min-w-0 [text-box:normal]"
										className="h-9 w-full rounded-lg px-3 text-left hover:bg-muted-hover"
									>
										<span className="flex w-full min-w-0 items-center gap-4">
											<MessageIcon size={14} className="shrink-0 text-muted-foreground/70" />
											<span className="min-w-0 flex-1 truncate text-[14px] font-medium text-surface-primary-foreground">
												{session.title}
											</span>
											<time
												dateTime={new Date(session.lastActivityAt).toISOString()}
												className="min-w-28 shrink-0 whitespace-nowrap text-right text-[12px] font-medium text-muted-foreground"
											>
												{formatProjectTime(session.lastActivityAt, intl)}
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
	const intl = useIntl();
	return (
		<div
			className="grid grid-cols-2 gap-4"
			role="status"
			aria-label={intl.formatMessage(desktopMessages.projectsLoading)}
		>
			{[0, 1, 2, 3].map((item) => (
				<div key={item} className="h-30 animate-pulse rounded-xl bg-foreground/3" />
			))}
		</div>
	);
}

function formatProjectTime(timestamp: number, intl: IntlShape): string {
	const age = Date.now() - timestamp;
	if (age < 7 * 24 * 60 * 60 * 1000) {
		return intl.formatRelativeTime(Math.round((timestamp - Date.now()) / 1000), "second", { numeric: "auto" });
	}
	return intl.formatDate(timestamp, { month: "short", day: "numeric" });
}
