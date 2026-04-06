import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [tailwindcss(), react(), codeInspectorPlugin({ bundler: "vite", editor: "cursor" })],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
		dedupe: ["react", "react-dom"],
	},
	optimizeDeps: {
		include: ["use-sync-external-store/shim"],
	},
});
