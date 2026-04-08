declare module "*.css";
declare module "electron-log/preload";

import type { IpcRenderer, IpcRendererEvent } from "electron";

declare global {
	interface Window {
		ipc: {
			invoke: IpcRenderer["invoke"];
			on: (
				channel: string,
				handler: (event: IpcRendererEvent, ...args: any[]) => void,
			) => () => void;
			send: IpcRenderer["send"];
		};
		desktop: {
			isMac: boolean;
		};
		__electronLog: {
			sendToMain(message: Record<string, unknown>): void;
			log(...data: unknown[]): void;
			error(...data: unknown[]): void;
			warn(...data: unknown[]): void;
			info(...data: unknown[]): void;
			verbose(...data: unknown[]): void;
			debug(...data: unknown[]): void;
		};
	}
}
