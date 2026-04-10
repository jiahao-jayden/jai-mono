import { app, BrowserWindow } from "electron";
import { setupCorsProxy } from "./cors";
import { gatewayProcess } from "./gateway-process";
import { mainLog } from "./logger";
import { createHandlers } from "./rpc/handlers";
import { restoreTheme } from "./rpc/handlers/theme";
import { registerRpcHandlers } from "./rpc/register";
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
	registerRpcHandlers(createHandlers());
	setupCorsProxy();
	createMainWindow();

	gatewayProcess.start().catch((err: unknown) => {
		mainLog.error("failed to start gateway:", err);
	});

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
