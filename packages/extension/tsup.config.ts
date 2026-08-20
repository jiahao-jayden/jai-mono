import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		connector: "src/connector.ts",
		"jai-plugins": "src/jai-plugins.ts",
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
