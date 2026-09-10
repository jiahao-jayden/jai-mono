import { useRef, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { cn } from "cn";
import type { CodingSession, DesktopProject } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { toast } from "../../ui/toast";
import { SessionActions } from "../session-actions";
import { sidebarItemClassName } from "./sidebar-nav";

interface SidebarRecentsProps {
	sessions: readonly CodingSession[];
	projects: readonly DesktopProject[];
	activeSessionId: string | null;
	loading: boolean;
	error?: string;
	hasNextPage?: boolean;
	loadingMore?: boolean;
	onSelectSession(sessionId: string): void;
	onRenameSession(sessionId: string, title: string): Promise<void>;
	onMoveSession(sessionId: string, projectId: string | null): Promise<void>;
	onDeleteSession(sessionId: string): Promise<void>;
	onLoadMore?(): void;
}

export function SidebarRecents({
	sessions,
	projects,
	activeSessionId,
	loading,
	error,
	hasNextPage = false,
	loadingMore = false,
	onSelectSession,
	onRenameSession,
	onMoveSession,
	onDeleteSession,
	onLoadMore,
}: SidebarRecentsProps) {
	const intl = useIntl();
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const cancelEditRef = useRef(false);

	const startEditing = (session: CodingSession) => {
		cancelEditRef.current = false;
		setEditingTitle(session.title);
		setEditingSessionId(session.id);
	};

	const cancelEditing = () => {
		cancelEditRef.current = true;
		setEditingSessionId(null);
	};

	const saveEditing = async (session: CodingSession) => {
		if (cancelEditRef.current) {
			cancelEditRef.current = false;
			return;
		}

		setEditingSessionId(null);
		const title = editingTitle.trim();
		if (!title || title === session.title) return;

		try {
			await onRenameSession(session.id, title);
		} catch {
			toast.add({
				title: intl.formatMessage(desktopMessages.sidebarRenameFailed),
				description: intl.formatMessage(desktopMessages.sidebarRenameFailed),
				type: "error",
			});
		}
	};

	return (
		<>
			<div className="mt-3.5 flex h-6 items-center px-3">
				<span className="text-[12px] font-medium tracking-[-0.005em] text-sidebar-muted">
					{intl.formatMessage(desktopMessages.sidebarRecents)}
				</span>
			</div>

			<div className="scrollbar-hidden mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
				{loading && sessions.length === 0 ? (
					<div
						className="space-y-0.5"
						role="status"
						aria-label={intl.formatMessage(desktopMessages.sidebarLoadingRecentSessions)}
					>
						{[0, 1, 2].map((item) => (
							<div key={item} className="h-[30px] animate-pulse rounded-lg bg-foreground/5" />
						))}
					</div>
				) : null}
				{error ? (
					<p className="rounded-lg bg-destructive/8 px-2 py-2 text-[12px] leading-relaxed text-destructive">
						{intl.formatMessage(desktopMessages.sidebarRecentsLoadError)}
					</p>
				) : null}
				{!loading && !error && sessions.length === 0 ? (
					<p className="px-2 py-1.5 text-[13px] leading-[18px] text-sidebar-muted">
						{intl.formatMessage(desktopMessages.sidebarNoRecentSessions)}
					</p>
				) : null}
				{sessions.map((session) => {
					const selected = session.id === activeSessionId;
					const editing = session.id === editingSessionId;
					return (
						<div className="group relative" key={session.id}>
							{editing ? (
								<Input
									autoFocus
									density="compact"
									value={editingTitle}
									onChange={(event) => setEditingTitle(event.target.value)}
									onBlur={() => void saveEditing(session)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											event.currentTarget.blur();
										} else if (event.key === "Escape") {
											event.preventDefault();
											cancelEditing();
										}
									}}
									aria-label={intl.formatMessage(desktopMessages.sessionTitle)}
									maxLength={80}
									className="h-[30px] rounded-lg border-transparent bg-sidebar-active px-[7px] py-0 text-[13px] leading-[18px] font-normal focus-visible:border-border-surface-strong focus-visible:shadow-none! focus-visible:ring-0"
								/>
							) : (
								<>
									<Button
										type="button"
										variant="navigation"
										size="md"
										onClick={() => onSelectSession(session.id)}
										onDoubleClick={() => selected && startEditing(session)}
										onKeyDown={(event) => {
											if (selected && event.key === "F2") {
												event.preventDefault();
												startEditing(session);
											}
										}}
										aria-current={selected ? "page" : undefined}
										active={selected}
										contentClassName="w-full min-w-0"
										labelClassName="min-w-0 flex-1 leading-[18px] [text-box:normal]"
										className={cn(sidebarItemClassName, "pr-7", {
											"shadow-[0_0_0_.5px_rgb(0_0_0/.05)]": selected,
										})}
									>
										<span className="block truncate">{session.title}</span>
									</Button>
									<SessionActions
										session={session}
										projects={projects}
										visible={selected}
										onStartRename={() => startEditing(session)}
										onMove={onMoveSession}
										onDelete={onDeleteSession}
									/>
								</>
							)}
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
						className={cn(sidebarItemClassName, "text-sidebar-muted")}
					>
						{intl.formatMessage(
							loadingMore ? desktopMessages.sidebarLoadingMore : desktopMessages.sidebarLoadMore,
						)}
					</Button>
				) : null}
			</div>
		</>
	);
}
