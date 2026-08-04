import type { CodingSession, SessionListCursor } from "@jai/coding/business";
import { type InfiniteData, infiniteQueryOptions, QueryClient } from "@tanstack/react-query";
import type { DesktopSessionListPage, DesktopWorkspace } from "../../shared/desktop-rpc";
import { desktop } from "./desktop";

export const SESSION_PAGE_SIZE = 50;

export const desktopQueryKeys = {
	workspaces: ["desktop", "workspaces"] as const,
	providerConfig: ["desktop", "provider-config"] as const,
	sessions: {
		recents: ["desktop", "sessions", "recents"] as const,
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
		typeof desktopQueryKeys.sessions.recents,
		SessionListCursor | undefined
	>({
		queryKey: desktopQueryKeys.sessions.recents,
		initialPageParam: undefined as SessionListCursor | undefined,
		queryFn: ({ pageParam }) =>
			desktop.session.list(
				pageParam ? { limit: SESSION_PAGE_SIZE, cursor: pageParam } : { limit: SESSION_PAGE_SIZE },
			),
		getNextPageParam: (page) => page.nextCursor,
	});
}

type SessionRecentsData = InfiniteData<DesktopSessionListPage, SessionListCursor | undefined>;

export function getRecentSessions(data: SessionRecentsData | undefined): CodingSession[] {
	if (!data) return [];
	const sessions = new Map<string, CodingSession>();
	const running = new Set<string>();
	for (const page of data.pages) {
		for (const session of page.sessions) sessions.set(session.id, session);
		for (const sessionId of page.runningSessionIds) running.add(sessionId);
	}
	return [...sessions.values()].toSorted(
		(left, right) =>
			Number(running.has(right.id)) - Number(running.has(left.id)) ||
			right.lastActivityAt - left.lastActivityAt ||
			right.id.localeCompare(left.id),
	);
}

export function getRunningSessionIds(data: SessionRecentsData | undefined): string[] {
	if (!data) return [];
	return [...new Set(data.pages.flatMap((page) => page.runningSessionIds))];
}

export function upsertWorkspace(workspace: DesktopWorkspace): void {
	desktopQueryClient.setQueryData<DesktopWorkspace[]>(desktopQueryKeys.workspaces, (current = []) => {
		const index = current.findIndex((candidate) => candidate.id === workspace.id);
		if (index < 0) return [...current, workspace];
		const next = [...current];
		next[index] = workspace;
		return next;
	});
}

export function upsertRecentSession(session: CodingSession): void {
	desktopQueryClient.setQueryData<SessionRecentsData>(desktopQueryKeys.sessions.recents, (current) => {
		if (!current || current.pages.length === 0) return current;
		const exists = current.pages.some((page) => page.sessions.some((candidate) => candidate.id === session.id));
		const pages = current.pages.map((page, pageIndex) => {
			const index = page.sessions.findIndex((candidate) => candidate.id === session.id);
			if (index < 0) {
				if (exists || pageIndex !== 0) return page;
				return { ...page, sessions: [session, ...page.sessions] };
			}
			const sessions = [...page.sessions];
			sessions[index] = session;
			return { ...page, sessions };
		});
		return { ...current, pages };
	});
}

export function invalidateRecentSessions(): Promise<void> {
	return desktopQueryClient.invalidateQueries({ queryKey: desktopQueryKeys.sessions.recents });
}
