import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { UtilityProcess } from "electron";

export type DesktopRuntimeHostLauncher = (input: {
	readonly entrypoint: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
}) => DesktopRuntimeHostProcess;

export interface DesktopRuntimeHostProcess {
	readonly stderr: NodeJS.ReadableStream | null;
	onExit(listener: (code: number | null, signal: string | null) => void): () => void;
	onError(listener: (error: unknown) => void): () => void;
	kill(): void;
	waitForExit(): Promise<void>;
}

/** Locates Desktop's standalone Runtime Host in either a packaged app or the local workspace. */
export function resolveDesktopRuntimeHostEntrypoint(): string | undefined {
	if (!process.versions.electron) return undefined;
	const electron = createRequire(import.meta.url)("electron") as { readonly app: { readonly isPackaged: boolean } };
	const app = electron.app;
	if (app.isPackaged) return join(process.resourcesPath, "dist", "main.js");
	const require = createRequire(import.meta.url);
	return join(dirname(require.resolve("@jai/server/package.json")), "dist", "main.js");
}

/** Starts the Node Runtime Host in a supervised child process without opening a second app. */
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
					readonly stdio: "pipe";
					readonly serviceName: string;
				},
			): UtilityProcess;
		};
	};
	if (!electron.app.isPackaged) {
		return ({ entrypoint, environment }) =>
			managedRuntimeHostProcess(
				spawn(process.env.JAI_RUNTIME_NODE_EXECUTABLE ?? "node", [entrypoint], {
					stdio: ["ignore", "ignore", "pipe"],
					env: runtimeHostProcessEnv(environment),
				}),
			);
	}
	return ({ entrypoint, environment }) =>
		managedRuntimeHostProcess(
			electron.utilityProcess.fork(entrypoint, [], {
				env: runtimeHostProcessEnv(environment),
				stdio: "pipe",
				serviceName: "JAI Runtime Host",
			}),
		);
}

function runtimeHostProcessEnv(environment: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...environment };
	if (env.NO_COLOR === undefined && env.FORCE_COLOR === undefined) env.FORCE_COLOR = "1";
	return env;
}

interface RuntimeHostChildLike {
	readonly stderr: NodeJS.ReadableStream | null;
	once(event: "exit", listener: (code: number | null, signal: string | null) => void): this;
	once(event: "error", listener: (error: unknown) => void): this;
	off(event: "exit", listener: (code: number | null, signal: string | null) => void): this;
	off(event: "error", listener: (error: unknown) => void): this;
	kill(): boolean;
}

export function managedRuntimeHostProcess(child: ChildProcess | UtilityProcess): DesktopRuntimeHostProcess {
	const process = child as unknown as RuntimeHostChildLike;
	let exited = false;
	const exit = (): void => {
		exited = true;
	};
	process.once("exit", exit);
	return {
		stderr: process.stderr,
		onExit(listener) {
			process.once("exit", listener);
			return () => process.off("exit", listener);
		},
		onError(listener) {
			process.once("error", listener);
			return () => process.off("error", listener);
		},
		kill() {
			process.kill();
		},
		waitForExit() {
			if (exited) return Promise.resolve();
			return new Promise<void>((resolve) => {
				process.once("exit", () => {
					exited = true;
					resolve();
				});
			});
		},
	};
}
