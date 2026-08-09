import { contextBridge, ipcRenderer, webUtils } from "electron";
import "electron-log/preload";
import { Value } from "@sinclair/typebox/value";
import {
	DESKTOP_EVENTS_CHANNEL,
	DESKTOP_RPC_CHANNEL,
	type DesktopAgentEventEnvelope,
	type DesktopBridge,
	desktopAgentEventEnvelopeSchema,
} from "../shared/desktop-rpc";

const desktopBridge: DesktopBridge = {
	platform: {
		isMac: process.platform === "darwin",
	},
	getFilePath(file) {
		return webUtils.getPathForFile(file);
	},
	invoke(request) {
		return ipcRenderer.invoke(DESKTOP_RPC_CHANNEL, request);
	},
	onAgentEvent(listener) {
		const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
			if (Value.Check(desktopAgentEventEnvelopeSchema, value)) {
				listener(value as DesktopAgentEventEnvelope);
			}
		};
		ipcRenderer.on(DESKTOP_EVENTS_CHANNEL, handler);
		return () => ipcRenderer.removeListener(DESKTOP_EVENTS_CHANNEL, handler);
	},
};

contextBridge.exposeInMainWorld("desktopRpc", desktopBridge);
