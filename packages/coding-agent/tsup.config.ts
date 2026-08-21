import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		sdk: "src/sdk.ts",
	},
	format: ["esm"],
	platform: "node",
	target: "node20",
	tsconfig: "tsconfig.build.json",
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	noExternal: [/^@jai\//],
});
