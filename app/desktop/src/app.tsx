import { useEffect } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { FilePanel } from "@/components/file-panel/file-panel";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useAppData } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { useFilePanelStore } from "@/stores/file-panel";
import { useSessionStore } from "@/stores/session";

export default function App() {
	useAppData();
	const filePanelOpen = useFilePanelStore((s) => s.open);
	const sessionId = useChatStore((s) => s.sessionId);
	const sessions = useSessionStore((s) => s.sessions);

	useEffect(() => {
		const fp = useFilePanelStore.getState();
		if (!sessionId) {
			fp.setOpen(false);
			fp.setWorkspaceId(null);
			fp.closeFile();
			return;
		}
		const session = sessions.find((s) => s.sessionId === sessionId);
		if (session) {
			fp.setWorkspaceId(session.workspaceId);
		}
		fp.closeFile();
	}, [sessionId, sessions]);

	return (
		<SidebarProvider className="h-svh overflow-hidden bg-background">
			<AppSidebar />
			<div className="flex flex-1 min-w-0 h-full py-2 pr-2 gap-2">
				<div className="flex-1 min-w-0 overflow-hidden">
					<ChatArea />
				</div>
				<div
					className={cn(
						"shrink-0 overflow-hidden transition-[width] duration-200 ease-out",
						filePanelOpen ? "w-[38%]" : "w-0",
					)}
				>
					{filePanelOpen && <FilePanel />}
				</div>
			</div>
		</SidebarProvider>
	);
}
