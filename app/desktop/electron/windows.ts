import { BrowserWindow, screen, shell } from "electron";
import { join } from "path";

const isMac = process.platform === "darwin";

let settingsWindow: BrowserWindow | null = null;

function baseWebPreferences(): Electron.WebPreferences {
	return {
		preload: join(__dirname, "preload.js"),
		contextIsolation: true,
		sandbox: false,
	};
}

export function createMainWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		show: false,
		frame: !isMac,
		titleBarStyle: isMac ? "hidden" : undefined,
		trafficLightPosition: isMac ? { x: -100, y: -100 } : undefined,
		webPreferences: baseWebPreferences(),
	});

	win.on("ready-to-show", () => win.show());
	win.webContents.setWindowOpenHandler((details: Electron.HandlerDetails) => {
		shell.openExternal(details.url);
		return { action: "deny" };
	});

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
	} else {
		win.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
	}

	return win;
}

export function createSettingsWindow(): void {
	if (settingsWindow && !settingsWindow.isDestroyed()) {
		if (settingsWindow.isMinimized()) settingsWindow.restore();
		settingsWindow.show();
		settingsWindow.focus();
		return;
	}

	const width = 1060;
	const height = 760;

	const parentWindow = BrowserWindow.getFocusedWindow();
	const display = parentWindow
		? screen.getDisplayMatching(parentWindow.getBounds())
		: screen.getPrimaryDisplay();
	const { x: dX, y: dY, width: dW, height: dH } = display.workArea;

	settingsWindow = new BrowserWindow({
		width,
		height,
		x: Math.round(dX + (dW - width) / 2),
		y: Math.round(dY + (dH - height) / 2),
		minWidth: 840,
		minHeight: 580,
		show: false,
		frame: !isMac,
		titleBarStyle: isMac ? "hidden" : undefined,
		trafficLightPosition: isMac ? { x: -100, y: -100 } : undefined,
		webPreferences: baseWebPreferences(),
	});

	settingsWindow.on("ready-to-show", () => settingsWindow?.show());
	settingsWindow.on("closed", () => {
		settingsWindow = null;
	});

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		settingsWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/settings`);
	} else {
		settingsWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
			hash: "/settings",
		});
	}
}
