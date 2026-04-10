import { create } from "zustand";
import type { Theme } from "../../electron/rpc/schema";
import { onEvent, rpc } from "@/lib/rpc";

function getSystemDark(): boolean {
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyToDOM(theme: Theme): void {
	const dark = theme === "dark" || (theme === "system" && getSystemDark());
	document.documentElement.classList.toggle("dark", dark);
}

interface ThemeState {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
	theme: "system",

	setTheme(theme: Theme) {
		rpc.theme.set(theme).catch(() => {});
		applyToDOM(theme);
		set({ theme });
	},
}));

export async function initTheme(): Promise<void> {
	const theme: Theme = (await rpc.theme.get().catch(() => "system" as const)) ?? "system";
	useThemeStore.setState({ theme });
	applyToDOM(theme);

	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		if (useThemeStore.getState().theme === "system") applyToDOM("system");
	});

	onEvent("theme:changed", (value) => {
		useThemeStore.setState({ theme: value });
		applyToDOM(value);
	});
}
