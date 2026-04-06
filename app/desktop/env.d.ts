declare module "*.css";

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
	}
}
