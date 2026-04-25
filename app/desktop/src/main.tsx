import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./app";
import Settings from "./components/settings";
import { initTheme } from "./stores/theme";
import "./styles/global.css";

const queryClient = new QueryClient();

function resolveView(): React.ReactNode {
	switch (window.location.hash) {
		case "#/settings":
			return <Settings />;
default:
			return <App />;
	}
}

initTheme().then(() => {
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider delayDuration={300}>
					{resolveView()}
					<Toaster richColors position="bottom-right" />
				</TooltipProvider>
			</QueryClientProvider>
		</React.StrictMode>,
	);
});
