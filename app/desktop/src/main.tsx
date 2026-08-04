import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/toast";
import { desktopQueryClient } from "@/lib/desktop-query";
import { ShapeProvider } from "@/lib/shape-context";
import { initTheme } from "./stores/theme";
import "./styles/global.css";
import App from "./app";

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
			<QueryClientProvider client={desktopQueryClient}>
				<ShapeProvider defaultShape="rounded">
					<App />
					<Toaster />
				</ShapeProvider>
			</QueryClientProvider>
		</React.StrictMode>,
	);
});
