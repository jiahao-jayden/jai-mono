import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import { mainLog } from "./logger";
import { createDesktopRouter } from "./rpc/router";
import { registerDesktopRpc } from "./rpc/server";
import { createDesktopRuntime, type DesktopRuntime } from "./runtime";
import { RemoteDesktopSessionCatalog } from "./session-catalog";
import { createMainWindow } from "./windows";

const isMac = process.platform === "darwin";
const customProtocol = "jai";
const bashParserWasmSourcesKey = "__jaiCodingAgentBashParserWasmSources";
const pendingOAuthCallbacks: string[] = [];
let desktopRuntime: DesktopRuntime | undefined;

if (!app.isPackaged) {
	app.commandLine.appendSwitch("remote-debugging-port", "9229");
}

registerBashParserWasm();

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
			const sessionCatalog = await RemoteDesktopSessionCatalog.open();
			const runtime = await createDesktopRuntime({
				sessions: sessionCatalog,
			});
			desktopRuntime = runtime;
			runtime.theme.restore();
			registerDesktopRpc(createDesktopRouter(runtime));
			createMainWindow();
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
	const runtime = desktopRuntime;
	desktopRuntime = undefined;
	void runtime?.close().catch((error) => mainLog.warn("Desktop runtime could not be closed cleanly:", error));
});

function receiveOAuthCallback(url: string): void {
	if (!isConnectorOAuthCallback(url)) return;
	const runtime = desktopRuntime;
	if (!runtime) {
		pendingOAuthCallbacks.push(url);
		return;
	}
	void runtime
		.receiveOAuthCallback(url)
		.then(focusMainWindow)
		.catch((error) => mainLog.warn("OAuth callback could not be completed:", error));
}

function registerBashParserWasm(): void {
	if (app.isPackaged) {
		Object.assign(globalThis, {
			[bashParserWasmSourcesKey]: {
			parser: join(process.resourcesPath, "tree-sitter.wasm"),
			bashLanguage: join(process.resourcesPath, "tree-sitter-bash.wasm"),
			},
		});
		return;
	}
	const require = createRequire(import.meta.url);
	Object.assign(globalThis, {
		[bashParserWasmSourcesKey]: {
			parser: require.resolve("web-tree-sitter/tree-sitter.wasm"),
			bashLanguage: require.resolve("tree-sitter-bash/tree-sitter-bash.wasm"),
		},
	});
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
