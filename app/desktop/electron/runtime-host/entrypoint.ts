import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type DesktopRuntimeHostLauncher = (input: {
	readonly entrypoint: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
}) => void;

/** Locates Desktop's standalone Runtime Host in either a packaged app or the local workspace. */
export function resolveDesktopRuntimeHostEntrypoint(): string | undefined {
	if (!process.versions.electron) return undefined;
	const electron = createRequire(import.meta.url)("electron") as { readonly app: { readonly isPackaged: boolean } };
	const app = electron.app;
	if (app.isPackaged) return join(process.resourcesPath, "dist", "main.js");
	const require = createRequire(import.meta.url);
	return join(dirname(require.resolve("@jai/server/package.json")), "dist", "main.js");
}

/** Starts the Node Runtime Host in an Electron utility process without opening a second app. */
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
	if (!electron.app.isPackaged) {
		return ({ entrypoint, environment }) => {
			const child = spawn(process.env.JAI_RUNTIME_NODE_EXECUTABLE ?? "node", [entrypoint], {
				detached: true,
				stdio: "ignore",
				env: environment,
			});
			child.unref();
		};
	}
	return ({ entrypoint, environment }) => {
		electron.utilityProcess.fork(entrypoint, [], {
			env: environment,
			stdio: "ignore",
			serviceName: "JAI Runtime Host",
		});
	};
}
