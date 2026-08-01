import { useQuery } from "@tanstack/react-query";
import { type EffectCallback, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";
import { useActiveSessionStore, useSessionListStore } from "@/stores/sessions";
import { ChatColumn } from "./chat-column";
import { Sidebar } from "./sidebar";
import { TaskPanel } from "./task-panel";
import { Titlebar } from "./titlebar";

export function WorkspaceShell() {
	const [rightPanelOpen, setRightPanelOpen] = useState(true);
	const sessionList = useSessionListStore();
	const activeSession = useActiveSessionStore();
	const workspacesQuery = useQuery({
		queryKey: ["workspaces"],
		queryFn: () => desktop.workspace.list(),
		staleTime: 30_000,
	});

	useMountEffect(() => {
		void useSessionListStore.getState().refresh();
	});

	const session = sessionList.sessions.find((candidate) => candidate.id === activeSession.sessionId);
	const workspaces = workspacesQuery.data ?? [];
	const workspaceId = session?.workspaceId ?? workspaces[0]?.id ?? null;
	const workspace = workspaces.find((candidate) => candidate.id === workspaceId);

	const send = async (message: string) => {
		if (activeSession.sessionId) {
			await activeSession.send(message);
			return;
		}
		await activeSession.createAndSend(workspaceId, message);
	};

	return (
		<div className="flex h-screen min-h-[640px] min-w-[1024px] flex-col overflow-hidden bg-background text-foreground">
			<Titlebar>
				<div className="pointer-events-none flex items-baseline gap-px select-none">
					<span className="font-serif text-[20px] font-semibold tracking-[-0.02em]">Panda</span>
					<span className="font-serif text-[20px] font-semibold tracking-[-0.02em] text-primary-2">Work</span>
				</div>
			</Titlebar>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<Sidebar
					sessions={sessionList.sessions}
					runningSessionIds={sessionList.runningSessionIds}
					activeSessionId={activeSession.sessionId}
					loading={sessionList.loading}
					error={sessionList.error}
					onNewChat={activeSession.newChat}
					onSelectSession={activeSession.open}
				/>
				<ChatColumn
					key={activeSession.sessionId ?? "new"}
					session={session}
					workspace={workspace}
					status={activeSession.status}
					items={activeSession.items}
					loading={activeSession.loading}
					error={activeSession.error}
					rightPanelOpen={rightPanelOpen && !!session}
					onToggleRightPanel={() => setRightPanelOpen((open) => !open)}
					onSend={send}
					onAbort={activeSession.abort}
					onResolvePermission={activeSession.resolvePermission}
				/>
				{rightPanelOpen && session ? (
					<TaskPanel status={activeSession.status} items={activeSession.items} workspace={workspace} />
				) : null}
			</div>
		</div>
	);
}

function useMountEffect(effect: EffectCallback) {
	// Session list hydration is an external store integration and only runs once.
	// biome-ignore lint/correctness/useExhaustiveDependencies: named mount-only integration
	useEffect(effect, []);
}
