import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import {
	desktopQueryKeys,
	getArchivedSessions,
	invalidateSessionLists,
	sessionArchivedQueryOptions,
} from "@/lib/desktop-query";
import type { CodingSession } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";

export function ArchivedChatsSettings() {
	const intl = useIntl();
	const [deletingSession, setDeletingSession] = useState<CodingSession | null>(null);
	const archivedQuery = useInfiniteQuery(sessionArchivedQueryOptions());
	const projectsQuery = useQuery({
		queryKey: desktopQueryKeys.projects,
		queryFn: () => desktop.project.list(),
	});
	const restoreMutation = useMutation({
		mutationFn: (sessionId: string) => desktop.session.restore({ sessionId }),
		onSuccess: () => invalidateSessionLists(),
	});
	const deleteMutation = useMutation({
		mutationFn: (sessionId: string) => desktop.session.delete({ sessionId }),
		onSuccess: () => invalidateSessionLists(),
	});
	const projectsById = useMemo(
		() => new Map((projectsQuery.data ?? []).map((project) => [project.id, project.displayName])),
		[projectsQuery.data],
	);
	const sessions = useMemo(() => getArchivedSessions(archivedQuery.data), [archivedQuery.data]);
	const restore = async (sessionId: string) => {
		try {
			await restoreMutation.mutateAsync(sessionId);
		} catch {
			// Mutation state exposes this recoverable failure beside the list.
		}
	};
	const confirmDelete = async () => {
		if (!deletingSession) return;
		try {
			await deleteMutation.mutateAsync(deletingSession.id);
			setDeletingSession(null);
		} catch {
			// Mutation state exposes this recoverable failure beside the dialog.
		}
	};
	const listError = archivedQuery.isError
		? intl.formatMessage(desktopMessages.settingsArchivedChatsLoadError)
		: restoreMutation.isError
			? intl.formatMessage(desktopMessages.settingsRestoreFailed)
			: undefined;
	const deletionError = deleteMutation.isError
		? intl.formatMessage(desktopMessages.settingsArchivedDeleteFailed)
		: undefined;

	return (
		<>
			<div className="mx-auto w-full max-w-3xl px-8 pb-8">
				{archivedQuery.isLoading ? (
					<p className="py-6 text-[13px] text-muted-foreground" role="status">
						{intl.formatMessage(desktopMessages.settingsArchivedChatsLoading)}
					</p>
				) : null}
				{listError ? (
					<p
						className="mt-5 rounded-lg bg-destructive/8 px-3 py-2 text-[12px] leading-relaxed text-destructive"
						role="alert"
					>
						{listError}
					</p>
				) : null}
				{!archivedQuery.isLoading && !listError && sessions.length === 0 ? (
					<p className="py-6 text-[13px] text-muted-foreground">
						{intl.formatMessage(desktopMessages.settingsArchivedChatsEmpty)}
					</p>
				) : null}
				{sessions.length > 0 ? (
					<div className="mt-5 space-y-1">
						{sessions.map((session) => {
							const archivedAt = session.archivedAt;
							const projectName = session.projectId
								? (projectsById.get(session.projectId) ?? intl.formatMessage(desktopMessages.settingsNoProject))
								: intl.formatMessage(desktopMessages.settingsNoProject);
							const archivedAtLabel = archivedAt
								? intl.formatDate(archivedAt, {
										year: "numeric",
										month: "short",
										day: "numeric",
										hour: "numeric",
										minute: "2-digit",
									})
								: "";
							return (
								<div
									className="flex min-w-0 items-center gap-4 rounded-lg bg-surface-secondary px-4 py-3"
									key={session.id}
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[13px] font-medium text-foreground">{session.title}</p>
										<p className="mt-0.5 truncate text-[12px] text-muted-foreground">{projectName}</p>
									</div>
									<time
										dateTime={archivedAt ? new Date(archivedAt).toISOString() : undefined}
										className="hidden shrink-0 text-right text-[12px] text-muted-foreground sm:block"
									>
										<span className="sr-only">{intl.formatMessage(desktopMessages.settingsArchivedAt)} </span>
										{archivedAtLabel}
									</time>
									<div className="flex shrink-0 items-center gap-1">
										<Button
											type="button"
											variant="tertiary"
											size="sm"
											loading={restoreMutation.isPending && restoreMutation.variables === session.id}
											disabled={deleteMutation.isPending}
											onClick={() => void restore(session.id)}
										>
											{intl.formatMessage(desktopMessages.settingsRestore)}
										</Button>
										<Button
											type="button"
											variant="tertiary"
											size="sm"
											disabled={restoreMutation.isPending || deleteMutation.isPending}
											onClick={() => setDeletingSession(session)}
											className="text-destructive"
										>
											{intl.formatMessage(desktopMessages.commonDelete)}
										</Button>
									</div>
								</div>
							);
						})}
						{archivedQuery.hasNextPage ? (
							<Button
								type="button"
								variant="tertiary"
								size="sm"
								disabled={archivedQuery.isFetchingNextPage}
								onClick={() => void archivedQuery.fetchNextPage()}
							>
								{intl.formatMessage(
									archivedQuery.isFetchingNextPage
										? desktopMessages.sidebarLoadingMore
										: desktopMessages.sidebarLoadMore,
								)}
							</Button>
						) : null}
					</div>
				) : null}
			</div>
			<Dialog
				open={deletingSession !== null}
				onOpenChange={(open) => {
					if (!open && !deleteMutation.isPending) setDeletingSession(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{intl.formatMessage(desktopMessages.settingsArchivedDeleteTitle)}</DialogTitle>
						<DialogDescription>
							{intl.formatMessage(desktopMessages.settingsArchivedDeleteDescription, {
								title: deletingSession?.title ?? "",
							})}
						</DialogDescription>
					</DialogHeader>
					{deletionError ? (
						<p className="text-[12px] leading-relaxed text-destructive" role="alert">
							{deletionError}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							disabled={deleteMutation.isPending}
							onClick={() => setDeletingSession(null)}
						>
							{intl.formatMessage(desktopMessages.commonCancel)}
						</Button>
						<Button
							type="button"
							variant="tertiary"
							loading={deleteMutation.isPending}
							onClick={() => void confirmDelete()}
							className="text-destructive"
						>
							{intl.formatMessage(desktopMessages.commonDelete)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
