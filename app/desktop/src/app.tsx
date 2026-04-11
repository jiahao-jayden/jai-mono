import { SidebarProvider } from "@/components/ui/sidebar";
import { useAppData } from "@/hooks/use-app-data";
import { ChatArea } from "./components/chat/chat-area";
import { AppSidebar } from "./components/shell/app-sidebar";

export default function App() {
	useAppData();

	return (
		<SidebarProvider className="h-svh overflow-hidden bg-background">
			<AppSidebar />
			<ChatArea />
		</SidebarProvider>
	);
}
