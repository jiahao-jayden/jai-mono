import path from "node:path";
import { defineConfig } from "vite";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
	build: {
		reportCompressedSize: false,
	},
	resolve: {
		alias: [
			{
				find: /^@jai\/extension\/skills$/,
				replacement: path.join(workspaceRoot, "packages/extension/src/skills/discover.ts"),
			},
			{ find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
		],
	},
});
