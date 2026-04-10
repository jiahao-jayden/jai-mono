import { BrowserWindow, type IpcMainInvokeEvent, systemPreferences } from "electron";
import { createSettingsWindow } from "../../windows";
import type { RpcSchema } from "../schema";
import type { RpcHandlers } from "../types";

const isMac = process.platform === "darwin";

export const windowHandlers: RpcHandlers<RpcSchema>["window"] = {
	close(event: IpcMainInvokeEvent) {
		BrowserWindow.fromWebContents(event.sender)?.close();
	},

	minimize(event: IpcMainInvokeEvent) {
		BrowserWindow.fromWebContents(event.sender)?.minimize();
	},

	fullscreen(event: IpcMainInvokeEvent) {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (win) win.setFullScreen(!win.isFullScreen());
	},

	titlebarDblClick(event: IpcMainInvokeEvent) {
		if (!isMac) return;
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) return;
		const action = systemPreferences.getUserDefault("AppleActionOnDoubleClick", "string");
		if (action === "Minimize") win.minimize();
		else if (action === "Maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
	},

	openSettings() {
		createSettingsWindow();
	},
};
