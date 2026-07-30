import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { initTheme } from "./stores/theme";
import "./styles/global.css";
import App from "./app";

const queryClient = new QueryClient();

// function resolveView(): React.ReactNode {
// 	switch (window.location.hash) {
// 		case "#/settings":
// 			return <Settings />;
// 		default:
// 			return <App />;
// 	}
// }

initTheme().then(() => {
	ReactDOM.createRoot(document.getElementById("root")!).render(
		<React.StrictMode>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</React.StrictMode>,
	);
});
