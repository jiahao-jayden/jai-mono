import { createRequire } from "node:module";
import { join } from "node:path";

export type DesktopRuntimeHostLauncher = (input: {
	readonly entrypoint: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
}) => void;

/** Locates Desktop's standalone Runtime Host only after Forge has packaged it into Resources. */
export function resolveDesktopRuntimeHostEntrypoint(): string | undefined {
	if (!process.versions.electron) return undefined;
	const electron = createRequire(import.meta.url)("electron") as { readonly app: { readonly isPackaged: boolean } };
	const app = electron.app;
	if (!app.isPackaged) return undefined;
	return join(process.resourcesPath, "dist", "main.js");
}

/** Starts the packaged Node Runtime Host without weakening Electron's RunAsNode fuse. */
export function createDesktopRuntimeHostLauncher(): DesktopRuntimeHostLauncher | undefined {
	if (!process.versions.electron) return undefined;
	const electron = createRequire(import.meta.url)("electron") as {
		readonly app: { readonly isPackaged: boolean };
		readonly utilityProcess: {
			fork(
				modulePath: string,
				args: string[],
				options: {
					readonly env: Readonly<Record<string, string | undefined>>;
					readonly stdio: "ignore";
					readonly serviceName: string;
				},
			): void;
		};
	};
	if (!electron.app.isPackaged) return undefined;
	return ({ entrypoint, environment }) => {
		electron.utilityProcess.fork(entrypoint, [], {
			env: environment,
			stdio: "ignore",
			serviceName: "JAI Runtime Host",
		});
	};
}
