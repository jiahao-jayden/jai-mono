import { resolve } from "node:path";
import { CodingBusinessService } from "@jai/coding/business";
import { app, BrowserWindow } from "electron";
import { createDesktopAgentFactory } from "./agent/factory";
import { type DesktopConnectorRuntime, openDesktopConnectorRuntime } from "./connector-runtime";
import { mainLog } from "./logger";
import { hydrateDesktopModelCatalog, startDesktopModelCatalog } from "./model-catalog";
import {
	closeDesktopRuntime,
	handleDesktopOAuthCallback,
	restoreTheme,
	setCodingBusinessService,
	setDesktopAgentFactory,
} from "./rpc/router";
import { registerDesktopRpc } from "./rpc/server";
import { createMainWindow } from "./windows";

const isMac = process.platform === "darwin";
const customProtocol = "jai";
const pendingOAuthCallbacks: string[] = [];
let desktopRuntimeReady = false;
let connectorRuntime: DesktopConnectorRuntime | undefined;

if (!app.isPackaged) {
	app.commandLine.appendSwitch("remote-debugging-port", "9229");
}

process.on("uncaughtException", (err) => {
	mainLog.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
	mainLog.error("unhandledRejection:", reason);
});

registerCustomProtocol();

app.on("open-url", (event, url) => {
	event.preventDefault();
	receiveOAuthCallback(url);
});

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", (_event, commandLine) => {
		const callback = commandLine.find(isConnectorOAuthCallback);
		if (callback) receiveOAuthCallback(callback);
		focusMainWindow();
	});

	void app
		.whenReady()
		.then(async () => {
			const [codingBusiness, openedConnectorRuntime] = await Promise.all([
				CodingBusinessService.open(),
				openDesktopConnectorRuntime(),
				hydrateDesktopModelCatalog(),
			]);
			connectorRuntime = openedConnectorRuntime;
			setCodingBusinessService(codingBusiness);
			setDesktopAgentFactory(createDesktopAgentFactory(codingBusiness, openedConnectorRuntime.service));
			restoreTheme();
			registerDesktopRpc();
			void startDesktopModelCatalog();
			createMainWindow();
			desktopRuntimeReady = true;
			for (const callback of pendingOAuthCallbacks.splice(0)) receiveOAuthCallback(callback);

			app.on("activate", () => {
				if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
			});
		})
		.catch((error) => {
			mainLog.error("Failed to initialize Desktop runtime:", error);
			app.quit();
		});
}

app.on("window-all-closed", () => {
	if (!isMac) app.quit();
});

app.on("before-quit", () => {
	connectorRuntime?.close();
	connectorRuntime = undefined;
	closeDesktopRuntime();
});

function receiveOAuthCallback(url: string): void {
	if (!isConnectorOAuthCallback(url)) return;
	if (!desktopRuntimeReady) {
		pendingOAuthCallbacks.push(url);
		return;
	}
	void handleDesktopOAuthCallback(url)
		.then(focusMainWindow)
		.catch((error) => mainLog.warn("OAuth callback could not be completed:", error));
}

function registerCustomProtocol(): void {
	if (isMac && !app.isPackaged) {
		mainLog.info("OAuth URL callbacks require the packaged JAI app on macOS");
		return;
	}
	if (process.defaultApp && process.argv[1]) {
		app.setAsDefaultProtocolClient(customProtocol, process.execPath, [resolve(process.argv[1])]);
		return;
	}
	app.setAsDefaultProtocolClient(customProtocol);
}

function isConnectorOAuthCallback(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "jai:" && url.hostname === "connector" && url.pathname === "/oauth/callback";
	} catch {
		return false;
	}
}

function focusMainWindow(): void {
	const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
	if (!window) return;
	if (window.isMinimized()) window.restore();
	window.focus();
}
