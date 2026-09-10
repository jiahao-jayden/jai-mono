import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		sdk: "src/sdk.ts",
	},
	format: ["esm"],
	platform: "node",
	target: "node20",
	tsconfig: "tsconfig.build.json",
	dts: {
		compilerOptions: {
			rootDir: "..",
			paths: {
				"@jai/agent": ["../agent/src/index.ts"],
				"@jai/ai": ["../ai/src/index.ts"],
				"@jai/telemetry": ["../telemetry/src/index.ts"],
			},
		},
	},
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	noExternal: [/^@jai\//],
});
