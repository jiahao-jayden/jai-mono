import { type InfiniteData, infiniteQueryOptions, QueryClient } from "@tanstack/react-query";
import type {
	CodingSession,
	DesktopProject,
	DesktopSessionListPage,
	SessionListCursor,
} from "../../shared/desktop-rpc";
import { desktop } from "./desktop";

export const SESSION_PAGE_SIZE = 50;

export const desktopQueryKeys = {
	projects: ["desktop", "projects"] as const,
	providerConfig: ["desktop", "provider-config"] as const,
	telemetry: ["desktop", "telemetry"] as const,
	mcp: ["desktop", "mcp"] as const,
	profileTokenStats: ["desktop", "profile-token-stats"] as const,
	sessions: {
		lists: ["desktop", "sessions", "lists"] as const,
		chats: ["desktop", "sessions", "lists", "chats"] as const,
		project: (projectId: string) => ["desktop", "sessions", "lists", "project", projectId] as const,
		byId: ["desktop", "sessions", "by-id"] as const,
		archived: ["desktop", "sessions", "archived"] as const,
	},
} as const;

export const desktopQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: false,
			refetchOnWindowFocus: false,
		},
		mutations: {
			retry: false,
		},
	},
});

export function sessionRecentsQueryOptions() {
	return infiniteQueryOptions<
		DesktopSessionListPage,
		Error,
		InfiniteData<DesktopSessionListPage, SessionListCursor | undefined>,
		typeof desktopQueryKeys.sessions.chats,
		SessionListCursor | undefined
	>({
		queryKey: desktopQueryKeys.sessions.chats,
		initialPageParam: undefined as SessionListCursor | undefined,
		queryFn: ({ pageParam }) =>
			desktop.session.list(
				pageParam
					? { limit: SESSION_PAGE_SIZE, cursor: pageParam, projectId: null }
					: { limit: SESSION_PAGE_SIZE, projectId: null },
			),
		getNextPageParam: (page) => page.nextCursor,
	});
}

export function projectSessionsQueryOptions(projectId: string) {
	return infiniteQueryOptions<
		DesktopSessionListPage,
		Error,
		InfiniteData<DesktopSessionListPage, SessionListCursor | undefined>,
		ReturnType<typeof desktopQueryKeys.sessions.project>,
		SessionListCursor | undefined
	>({
		queryKey: desktopQueryKeys.sessions.project(projectId),
		initialPageParam: undefined as SessionListCursor | undefined,
		queryFn: ({ pageParam }) =>
			desktop.session.list(
				pageParam
					? { limit: SESSION_PAGE_SIZE, cursor: pageParam, projectId }
					: { limit: SESSION_PAGE_SIZE, projectId },
			),
		getNextPageParam: (page) => page.nextCursor,
	});
}

export function sessionArchivedQueryOptions() {
	return infiniteQueryOptions<
		DesktopSessionListPage,
		Error,
		InfiniteData<DesktopSessionListPage, SessionListCursor | undefined>,
		typeof desktopQueryKeys.sessions.archived,
		SessionListCursor | undefined
	>({
		queryKey: desktopQueryKeys.sessions.archived,
		initialPageParam: undefined as SessionListCursor | undefined,
		queryFn: ({ pageParam }) =>
			desktop.session.list(
				pageParam
					? { limit: SESSION_PAGE_SIZE, archived: true, cursor: pageParam }
					: { limit: SESSION_PAGE_SIZE, archived: true },
			),
		getNextPageParam: (page) => page.nextCursor,
	});
}

type SessionPagesData = InfiniteData<DesktopSessionListPage, SessionListCursor | undefined>;

export function getRecentSessions(data: SessionPagesData | undefined): CodingSession[] {
	if (!data) return [];
	const sessions = new Map<string, CodingSession>();
	const running = new Set<string>();
	for (const page of data.pages) {
		for (const session of page.sessions) sessions.set(session.id, session);
		for (const sessionId of page.runningSessionIds) running.add(sessionId);
	}
	// ponytail: 只重排已加载页。更旧的置顶会话要等翻页进来才会到顶部；升级路径是独立 pinned query。
	return [...sessions.values()].toSorted(
		(left, right) =>
			Number(right.pinnedAt !== null) - Number(left.pinnedAt !== null) ||
			Number(running.has(right.id)) - Number(running.has(left.id)) ||
			right.lastActivityAt - left.lastActivityAt ||
			right.id.localeCompare(left.id),
	);
}

export function getArchivedSessions(data: SessionPagesData | undefined): CodingSession[] {
	if (!data) return [];
	const sessions = new Map<string, CodingSession>();
	for (const page of data.pages) {
		for (const session of page.sessions) sessions.set(session.id, session);
	}
	return [...sessions.values()];
}

export function getRunningSessionIds(data: SessionPagesData | undefined): string[] {
	if (!data) return [];
	return [...new Set(data.pages.flatMap((page) => page.runningSessionIds))];
}

export function upsertProject(project: DesktopProject): void {
	desktopQueryClient.setQueryData<DesktopProject[]>(desktopQueryKeys.projects, (current = []) => {
		const index = current.findIndex((candidate) => candidate.id === project.id);
		if (index < 0) return [project, ...current];
		const next = [...current];
		next[index] = project;
		return next;
	});
}

function resyncProjectsOnFailure(request: Promise<void>): Promise<void> {
	return request.catch(() => desktopQueryClient.invalidateQueries({ queryKey: desktopQueryKeys.projects }));
}

export function reorderProjects(projectIds: readonly string[]): Promise<void> {
	desktopQueryClient.setQueryData<DesktopProject[]>(desktopQueryKeys.projects, (current = []) => {
		const byId = new Map(current.map((project) => [project.id, project]));
		return projectIds.flatMap((id) => byId.get(id) ?? []);
	});
	return resyncProjectsOnFailure(desktop.project.reorder(projectIds));
}

export function setProjectExpanded(projectId: string, expanded: boolean): Promise<void> {
	desktopQueryClient.setQueryData<DesktopProject[]>(desktopQueryKeys.projects, (current = []) =>
		current.map((project) => (project.id === projectId ? { ...project, expanded } : project)),
	);
	return resyncProjectsOnFailure(desktop.project.setExpanded({ projectId, expanded }));
}

function withSession(current: SessionPagesData, session: CodingSession, insert: boolean): SessionPagesData {
	const exists = current.pages.some((page) => page.sessions.some((candidate) => candidate.id === session.id));
	return {
		...current,
		pages: current.pages.map((page, pageIndex) => {
			const index = page.sessions.findIndex((candidate) => candidate.id === session.id);
			if (index >= 0) {
				const sessions = [...page.sessions];
				sessions[index] = session;
				return { ...page, sessions };
			}
			if (insert && !exists && pageIndex === 0) return { ...page, sessions: [session, ...page.sessions] };
			return page;
		}),
	};
}

export function upsertRecentSession(session: CodingSession): void {
	desktopQueryClient.setQueriesData<SessionPagesData>({ queryKey: desktopQueryKeys.sessions.lists }, (current) =>
		current ? withSession(current, session, false) : current,
	);
	const queryKey =
		session.projectId === null
			? desktopQueryKeys.sessions.chats
			: desktopQueryKeys.sessions.project(session.projectId);
	desktopQueryClient.setQueryData<SessionPagesData>(queryKey, (current) =>
		current && current.pages.length > 0 ? withSession(current, session, true) : current,
	);
	desktopQueryClient.setQueryData([...desktopQueryKeys.sessions.byId, session.id], session);
}

export function removeRecentSession(sessionId: string): void {
	desktopQueryClient.setQueriesData<SessionPagesData>({ queryKey: desktopQueryKeys.sessions.lists }, (current) => {
		if (!current) return current;
		return {
			...current,
			pages: current.pages.map((page) => ({
				...page,
				sessions: page.sessions.filter((session) => session.id !== sessionId),
				runningSessionIds: page.runningSessionIds.filter((id) => id !== sessionId),
			})),
		};
	});
	desktopQueryClient.removeQueries({ queryKey: [...desktopQueryKeys.sessions.byId, sessionId] });
}

export function invalidateRecentSessions(): Promise<void> {
	return desktopQueryClient.invalidateQueries({ queryKey: desktopQueryKeys.sessions.lists });
}

export function invalidateSessionLists(): Promise<void> {
	return Promise.all([
		desktopQueryClient.invalidateQueries({ queryKey: desktopQueryKeys.sessions.lists }),
		desktopQueryClient.invalidateQueries({ queryKey: desktopQueryKeys.sessions.archived }),
	]).then(() => {});
}
