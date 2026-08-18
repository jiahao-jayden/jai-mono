import { TaggedError } from "better-result";
import { nativeTheme } from "electron";
import Store from "electron-store";
import type { DesktopTheme } from "../shared/desktop-rpc";

class InvalidThemeValue extends TaggedError("desktop_theme.invalid_value")<{ readonly message: string }> {}

export interface DesktopThemeService {
	get(): DesktopTheme;
	set(theme: DesktopTheme): void;
	restore(): void;
}

export function isDesktopTheme(value: unknown): value is DesktopTheme {
	return value === "light" || value === "dark" || value === "system";
}

export function createDesktopThemeService(): DesktopThemeService {
	const store = new Store<{ theme: DesktopTheme }>({ defaults: { theme: "system" } });
	return {
		get() {
			return store.get("theme");
		},
		set(theme) {
			if (!isDesktopTheme(theme)) {
				throw new InvalidThemeValue({ message: "Theme must be light, dark, or system" });
			}
			store.set("theme", theme);
			nativeTheme.themeSource = theme;
		},
		restore() {
			nativeTheme.themeSource = store.get("theme");
		},
	};
}
