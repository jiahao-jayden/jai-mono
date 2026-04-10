import { BrowserWindow, nativeTheme } from "electron";
import Store from "electron-store";
import type { RpcSchema, Theme } from "../schema";
import type { RpcHandlers } from "../types";

const store = new Store<{ theme: Theme }>({
	defaults: { theme: "system" },
});

export function restoreTheme(): void {
	nativeTheme.themeSource = store.get("theme");
}

export const themeHandlers: RpcHandlers<RpcSchema>["theme"] = {
	get() {
		return store.get("theme");
	},

	set(_event, theme) {
		store.set("theme", theme);
		nativeTheme.themeSource = theme;
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("theme:changed", theme);
		}
	},
};
