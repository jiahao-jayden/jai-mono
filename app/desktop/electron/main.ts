import { app, BrowserWindow } from "electron";
import { mainLog } from "./logger";
import { closeDesktopAgentHost, restoreTheme } from "./rpc/router";
import { registerDesktopRpc } from "./rpc/server";
import { createMainWindow } from "./windows";

const isMac = process.platform === "darwin";

if (!app.isPackaged) {
	app.commandLine.appendSwitch("remote-debugging-port", "9229");
}

process.on("uncaughtException", (err) => {
	mainLog.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
	mainLog.error("unhandledRejection:", reason);
});

app.whenReady().then(() => {
	restoreTheme();
	registerDesktopRpc();
	createMainWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
	});
});

app.on("window-all-closed", () => {
	if (!isMac) app.quit();
});

app.on("before-quit", () => {
	closeDesktopAgentHost();
});
