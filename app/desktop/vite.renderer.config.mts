import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

function bunCompat(): Plugin {
	const bunCacheDir = path.resolve(import.meta.dirname, "../../node_modules/.bun");
	let extraNodePaths: string[] = [];

	if (fs.existsSync(bunCacheDir)) {
		extraNodePaths = fs
			.readdirSync(bunCacheDir)
			.map((entry) => path.join(bunCacheDir, entry, "node_modules"))
			.filter((p) => fs.existsSync(p));
	}

	return {
		name: "bun-compat",
		config() {
			if (extraNodePaths.length === 0) return;
			return {
				optimizeDeps: {
					esbuildOptions: { nodePaths: extraNodePaths },
				},
			};
		},
		resolveId(source) {
			if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null;
			const pkgName = source.startsWith("@") ? source.split("/").slice(0, 2).join("/") : source.split("/")[0];
			const subpath = source.slice(pkgName.length);

			for (const np of extraNodePaths) {
				const candidate = path.join(np, pkgName);
				if (fs.existsSync(candidate)) {
					return { id: subpath ? path.join(candidate, subpath) : candidate, external: false };
				}
			}
			return null;
		},
	};
}

export default defineConfig({
	plugins: [bunCompat(), codeInspectorPlugin({ bundler: "vite", editor: "cursor" }), tailwindcss(), react()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
		dedupe: ["react", "react-dom"],
	},
	optimizeDeps: {},
});
