import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ipc", {
	invoke: ipcRenderer.invoke.bind(ipcRenderer),
	on(channel: string, handler: (event: Electron.IpcRendererEvent, ...args: any[]) => void) {
		ipcRenderer.on(channel, handler);
		return () => {
			ipcRenderer.removeListener(channel, handler);
		};
	},
	send: ipcRenderer.send.bind(ipcRenderer),
});

contextBridge.exposeInMainWorld("desktop", {
	isMac: process.platform === "darwin",
});
