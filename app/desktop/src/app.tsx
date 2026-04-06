import { SidebarProvider } from "@/components/ui/sidebar";
import { useChat } from "@/hooks/use-chat";
import { ChatArea } from "./components/chat/chat-area";
import { AppSidebar } from "./components/shell/app-sidebar";

function App(): React.JSX.Element {
	useChat();

	return (
		<SidebarProvider className="h-svh overflow-hidden bg-background">
			<AppSidebar />
			<ChatArea />
		</SidebarProvider>
	);
}

export default App;
