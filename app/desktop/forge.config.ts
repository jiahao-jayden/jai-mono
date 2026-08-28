import { createRequire } from "node:module";
import { join } from "node:path";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const require = createRequire(import.meta.url);

/** tree-sitter wasm cannot be resolved from inside asar, so it ships alongside it in Resources. */
const wasmResources = [
	require.resolve("web-tree-sitter/tree-sitter.wasm"),
	require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"),
];
const runtimeHostResource = join(import.meta.dirname, "../server/dist");

const config: ForgeConfig = {
	packagerConfig: {
		appBundleId: "com.jayden.jai",
		asar: true,
		executableName: "JAI",
		extraResource: [...wasmResources, runtimeHostResource],
		protocols: [
			{
				name: "JAI Connector",
				schemes: ["jai"],
			},
		],
	},
	rebuildConfig: {},
	makers: [new MakerSquirrel({}), new MakerZIP({}, ["darwin"]), new MakerDeb({})],
	plugins: [
		new VitePlugin({
			build: [
				{
					entry: "electron/main.ts",
					config: "vite.main.config.mts",
					target: "main",
				},
				{
					entry: "electron/preload.ts",
					config: "vite.preload.config.mts",
					target: "preload",
				},
			],
			renderer: [
				{
					name: "main_window",
					config: "vite.renderer.config.mts",
				},
			],
		}),
		new FusesPlugin({
			version: FuseVersion.V1,
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			[FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
};

export default config;
