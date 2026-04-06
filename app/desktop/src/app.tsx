import { SidebarProvider } from "@/components/ui/sidebar";
import { useGatewayChat } from "@/hooks/use-gateway-chat";
import { AppSidebar } from "./components/shell/app-sidebar";
import { ChatArea } from "./components/chat/chat-area";

function App(): React.JSX.Element {
	const chat = useGatewayChat();

	return (
		<SidebarProvider className="h-svh overflow-hidden bg-background">
			<AppSidebar
				activeSessionId={chat.sessionId}
				onNewChat={chat.newChat}
				onSelectSession={chat.loadSession}
			/>
			<ChatArea chat={chat} />
		</SidebarProvider>
	);
}

export default App;
