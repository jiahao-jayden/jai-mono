import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import App from "./app";
import Settings from "./components/settings";
import { initTheme } from "./stores/theme";
import "./styles/global.css";

const queryClient = new QueryClient();
const isSettings = window.location.hash === "#/settings";

initTheme().then(() => {
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<QueryClientProvider client={queryClient}>
				{isSettings ? <Settings /> : <App />}
				<Toaster richColors position="bottom-right" />
			</QueryClientProvider>
		</React.StrictMode>,
	);
});
