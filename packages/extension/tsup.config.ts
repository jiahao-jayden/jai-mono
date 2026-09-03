import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		connector: "src/connector/index.ts",
		"agent-plugins": "src/agent-plugins/index.ts",
		skills: "src/skills/index.ts",
		search: "src/search/index.ts",
		"web-search": "src/web-search/index.ts",
		mcp: "src/mcp/index.ts",
	},
	format: ["esm"],
	platform: "node",
	target: "node20",
	dts: false,
	tsconfig: "tsconfig.build.json",
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	noExternal: [/^@jai\//],
});
