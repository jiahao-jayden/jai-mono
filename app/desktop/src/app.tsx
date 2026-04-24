import { useEffect, useMemo, useRef } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { FilePanel } from "@/components/file-panel/file-panel";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useAppData } from "@/hooks/use-app-data";
import { useChatStore } from "@/stores/chat";
import { useFilePanelStore } from "@/stores/file-panel";
import { useSessionStore } from "@/stores/session";

export default function App() {
	useAppData();
	const filePanelOpen = useFilePanelStore((s) => s.open);
	const sessionId = useChatStore((s) => s.sessionId);
	const sessions = useSessionStore((s) => s.sessions);
	const workspaceId = useMemo(
		() => sessions.find((s) => s.sessionId === sessionId)?.workspaceId ?? null,
		[sessionId, sessions],
	);
	const prevSessionIdRef = useRef<string | null>(null);
	const prevWorkspaceIdRef = useRef<string | null>(null);

	useEffect(() => {
		const fp = useFilePanelStore.getState();
		if (!sessionId) {
			fp.setOpen(false);
			fp.setWorkspaceId(null);
			fp.closeFile();
			prevSessionIdRef.current = null;
			prevWorkspaceIdRef.current = null;
			return;
		}
		fp.setWorkspaceId(workspaceId);
		const sessionChanged = prevSessionIdRef.current !== sessionId;
		const workspaceChanged = prevWorkspaceIdRef.current !== workspaceId;
		if (sessionChanged || workspaceChanged) {
			fp.closeFile();
		}
		prevSessionIdRef.current = sessionId;
		prevWorkspaceIdRef.current = workspaceId;
	}, [sessionId, workspaceId]);

	return (
		<SidebarProvider className="h-svh overflow-hidden bg-background">
			<AppSidebar />
			<div className="flex-1 min-w-0 h-full py-2 pr-2">
				{filePanelOpen ? (
					<ResizablePanelGroup orientation="horizontal" id="app-chat-file-split">
						<ResizablePanel defaultSize="55%" minSize="30%">
							<div className="h-full overflow-hidden">
								<ChatArea />
							</div>
						</ResizablePanel>
						<ResizableHandle className="mx-1 bg-transparent" />
						<ResizablePanel defaultSize="45%" minSize="20%" maxSize="60%">
							<FilePanel />
						</ResizablePanel>
					</ResizablePanelGroup>
				) : (
					<ChatArea />
				)}
			</div>
		</SidebarProvider>
	);
}
