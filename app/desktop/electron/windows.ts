import { BrowserWindow, shell } from "electron";
import { join } from "path";

const isMac = process.platform === "darwin";

function baseWebPreferences(): Electron.WebPreferences {
	return {
		preload: join(__dirname, "preload.js"),
		contextIsolation: true,
		sandbox: true,
	};
}

export function createMainWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		// 与 AppShell 根节点的 min-w-5xl / min-h-160 一致，窗口缩到更小时 shell 会溢出被裁。
		minWidth: 1024,
		minHeight: 640,
		show: false,
		frame: !isMac,
		titleBarStyle: isMac ? "hidden" : undefined,
		trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
		vibrancy: isMac ? "hud" : undefined,
		visualEffectState: isMac ? "active" : undefined,
		backgroundColor: isMac ? "#00000000" : undefined,
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
