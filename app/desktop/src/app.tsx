import { SidebarProvider } from "@/components/ui/sidebar";
import { useGatewayChat } from "@/hooks/use-gateway-chat";
import { ChatArea } from "./components/chat/chat-area";
import { AppSidebar } from "./components/shell/app-sidebar";

function App(): React.JSX.Element {
	const chat = useGatewayChat();

	return (
		<SidebarProvider className="h-svh overflow-hidden bg-background">
			<AppSidebar activeSessionId={chat.sessionId} onNewChat={chat.newChat} onSelectSession={chat.loadSession} />
			<ChatArea chat={chat} />
		</SidebarProvider>
	);
}

export default App;
