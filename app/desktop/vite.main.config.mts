import path from "node:path";
import { defineConfig } from "vite";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
	build: {
		rollupOptions: {
			external: ["node:sqlite"],
		},
	},
	resolve: {
		alias: [
			{ find: /^@jai\/coding-agent$/, replacement: path.join(workspaceRoot, "packages/coding-agent/src/sdk.ts") },
			{
				find: /^@jai\/extension\/connector$/,
				replacement: path.join(workspaceRoot, "packages/extension/src/connector/index.ts"),
			},
			{
				find: /^@jai\/extension\/agent-plugins$/,
				replacement: path.join(workspaceRoot, "packages/extension/src/agent-plugins/index.ts"),
			},
			{ find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
		],
	},
});
