import { defineCodedError } from "@jai/common";
import { BrowserWindow, type IpcMainInvokeEvent, nativeTheme } from "electron";
import Store from "electron-store";

export type Theme = "light" | "dark" | "system";

const themeStore = new Store<{ theme: Theme }>({
	defaults: { theme: "system" },
});

const themeError = defineCodedError("desktop_theme", ["invalid_value"] as const);

export function restoreTheme(): void {
	nativeTheme.themeSource = themeStore.get("theme");
}

export const desktopRouter = {
	window: {
		close(event: IpcMainInvokeEvent) {
			BrowserWindow.fromWebContents(event.sender)?.close();
		},
		minimize(event: IpcMainInvokeEvent) {
			BrowserWindow.fromWebContents(event.sender)?.minimize();
		},
		fullscreen(event: IpcMainInvokeEvent) {
			const window = BrowserWindow.fromWebContents(event.sender);
			if (window) window.setFullScreen(!window.isFullScreen());
		},
	},
	theme: {
		get(_event: IpcMainInvokeEvent) {
			return themeStore.get("theme");
		},
		set(_event: IpcMainInvokeEvent, theme: Theme) {
			if (!isTheme(theme)) {
				throw themeError("invalid_value", {
					message: "Theme must be light, dark, or system",
				});
			}
			themeStore.set("theme", theme);
			nativeTheme.themeSource = theme;
		},
	},
} as const;

export type DesktopRouter = typeof desktopRouter;

function isTheme(value: unknown): value is Theme {
	return value === "light" || value === "dark" || value === "system";
}
