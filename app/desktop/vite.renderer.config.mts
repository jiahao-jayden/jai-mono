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

	// ponytail: esbuild nodePaths returns the first match, and readdir order is
	// not version order. @base-ui/react 1.4 imports utils files that only exist
	// in 0.2.7, while @lobehub/ui still nests 0.2.3. Hoist the newest
	// @base-ui/utils ahead of the other store folders. Ceiling: every renderer
	// import of that package gets the newest copy, not the importer's nested
	// one. Upgrade path: resolve from the importer realpath and drop nodePaths.
	const baseUiUtilsPaths = extraNodePaths
		.flatMap((nodeModulesPath) => {
			const manifestPath = path.join(nodeModulesPath, "@base-ui/utils/package.json");
			if (!fs.existsSync(manifestPath)) return [];
			const version = (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: string }).version ?? "0.0.0";
			return [{ nodeModulesPath, version }];
		})
		.sort((left, right) => right.version.localeCompare(left.version, "en", { numeric: true }))
		.map((entry) => entry.nodeModulesPath);
	const versionedNodePaths = [
		...baseUiUtilsPaths,
		...extraNodePaths.filter((nodeModulesPath) => !baseUiUtilsPaths.includes(nodeModulesPath)),
	];

	return {
		name: "bun-compat",
		config() {
			if (versionedNodePaths.length === 0) return;
			return {
				optimizeDeps: {
					esbuildOptions: { nodePaths: versionedNodePaths },
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

function reactScanDev(): Plugin {
	const scanScript = path.resolve(import.meta.dirname, "node_modules/react-scan/dist/auto.global.js");
	return {
		name: "react-scan-dev",
		apply: "serve",
		transformIndexHtml() {
			if (!fs.existsSync(scanScript)) return;
			return [
				{
					tag: "script",
					attrs: { src: `/@fs/${scanScript}` },
					injectTo: "head-prepend",
				},
			];
		},
	};
}

export default defineConfig({
	plugins: [
		bunCompat(),
		// reactScanDev(),
		codeInspectorPlugin({ bundler: "vite", editor: "cursor" }),
		tailwindcss(),
		react(),
	],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
		dedupe: ["react", "react-dom"],
	},
	optimizeDeps: {},
});
