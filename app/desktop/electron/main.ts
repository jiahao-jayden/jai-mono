import {
	app,
	BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	session,
	systemPreferences,
} from "electron";
import { gatewayProcess } from "./gateway-process";
import { createMainWindow, createSettingsWindow } from "./windows";

const isMac = process.platform === "darwin";

app.whenReady().then(() => {
	registerIpcHandlers();
	createMainWindow();

	gatewayProcess.start().catch((err: unknown) => {
		console.error("[main] failed to start gateway:", err);
	});

	const externalFilter = { urls: ["https://*/*", "http://*/*"] };

	session.defaultSession.webRequest.onBeforeSendHeaders(
		externalFilter,
		(details: Electron.OnBeforeSendHeadersListenerDetails, callback: (response: Electron.BeforeSendResponse) => void) => {
			const headers = { ...details.requestHeaders };
			delete headers["Origin"];
			callback({ requestHeaders: headers });
		},
	);

	session.defaultSession.webRequest.onHeadersReceived(
		externalFilter,
		(details: Electron.OnHeadersReceivedListenerDetails, callback: (response: Electron.HeadersReceivedResponse) => void) => {
			const headers: Record<string, string[]> = { ...details.responseHeaders } as Record<string, string[]>;
			for (const key of Object.keys(headers)) {
				if (key.toLowerCase().startsWith("access-control-")) {
					delete headers[key];
				}
			}
			headers["Access-Control-Allow-Origin"] = ["*"];
			headers["Access-Control-Allow-Methods"] = ["GET, POST, PUT, DELETE, OPTIONS"];
			headers["Access-Control-Allow-Headers"] = ["*"];
			callback({ responseHeaders: headers });
		},
	);

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
	});
});

app.on("before-quit", () => {
	gatewayProcess.dispose();
});

app.on("window-all-closed", () => {
	if (!isMac) app.quit();
});

function registerIpcHandlers(): void {
	ipcMain.handle("window:close", (event: IpcMainInvokeEvent) => {
		BrowserWindow.fromWebContents(event.sender)?.close();
	});

	ipcMain.handle("window:minimize", (event: IpcMainInvokeEvent) => {
		BrowserWindow.fromWebContents(event.sender)?.minimize();
	});

	ipcMain.handle("window:fullscreen", (event: IpcMainInvokeEvent) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (win) win.setFullScreen(!win.isFullScreen());
	});

	ipcMain.handle("window:titlebar-dblclick", (event: IpcMainInvokeEvent) => {
		if (!isMac) return;
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) return;
		const action = systemPreferences.getUserDefault("AppleActionOnDoubleClick", "string");
		if (action === "Minimize") win.minimize();
		else if (action === "Maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
	});

	ipcMain.handle("window:open-settings", () => {
		createSettingsWindow();
	});

	ipcMain.handle("gateway:info", () => {
		return {
			port: gatewayProcess.port,
			baseURL: gatewayProcess.baseURL,
			ready: gatewayProcess.ready,
		};
	});
}
