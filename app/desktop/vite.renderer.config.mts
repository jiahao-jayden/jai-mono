import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

function bunCompat(): Plugin {
	const bunCacheDir = path.resolve(import.meta.dirname, "../../node_modules/.bun");
	let extraNodePaths: string[] = [];
	const fallbackResolvers = new Map<string, NodeJS.Require>();

	if (fs.existsSync(bunCacheDir)) {
		extraNodePaths = fs
			.readdirSync(bunCacheDir)
			.map((entry) => path.join(bunCacheDir, entry, "node_modules"))
			.filter((p) => fs.existsSync(p));

		for (const nodePath of extraNodePaths) {
			fallbackResolvers.set(nodePath, createRequire(path.join(nodePath, "__bun-compat__.cjs")));
		}
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
		async resolveId(source, importer) {
			if (source.startsWith(".") || source.startsWith("/") || source.startsWith("\0")) return null;

			const resolved = await this.resolve(source, importer, { skipSelf: true });
			if (resolved) return resolved;

			const resolvers: NodeJS.Require[] = [];

			if (importer && !importer.startsWith("\0")) {
				const importerPath = importer.split("?")[0];
				if (importerPath) {
					try {
						resolvers.push(createRequire(fs.realpathSync(importerPath)));
					} catch {
						// Ignore unresolved virtual or non-file importers and fall back to Bun store resolvers.
					}
				}
			}

			for (const resolver of fallbackResolvers.values()) {
				resolvers.push(resolver);
			}

			for (const resolver of resolvers) {
				try {
					return { id: resolver.resolve(source), external: false };
				} catch {
					// Try the next resolver.
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
