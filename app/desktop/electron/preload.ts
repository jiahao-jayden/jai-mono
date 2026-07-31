import { contextBridge, ipcRenderer } from "electron";
import "electron-log/preload";
import { DESKTOP_RPC_CHANNEL, type DesktopBridge } from "../shared/desktop-rpc";

const desktopBridge: DesktopBridge = {
	platform: {
		isMac: process.platform === "darwin",
	},
	invoke(request) {
		return ipcRenderer.invoke(DESKTOP_RPC_CHANNEL, request);
	},
};

contextBridge.exposeInMainWorld("desktopRpc", desktopBridge);
