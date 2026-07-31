import { useEffect, useState } from "react";
import { create } from "zustand";
import { desktop } from "@/lib/desktop";
import type { DesktopTheme } from "../../shared/desktop-rpc";

function getSystemDark(): boolean {
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyToDOM(theme: DesktopTheme): void {
	const dark = theme === "dark" || (theme === "system" && getSystemDark());
	document.documentElement.classList.toggle("dark", dark);
}

interface ThemeState {
	theme: DesktopTheme;
	setTheme: (theme: DesktopTheme) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
	theme: "system",

	setTheme(theme: DesktopTheme) {
		desktop.theme.set(theme).catch(() => {});
		applyToDOM(theme);
		set({ theme });
	},
}));

export async function initTheme(): Promise<void> {
	const theme: DesktopTheme = (await desktop.theme.get().catch(() => "system" as const)) ?? "system";
	useThemeStore.setState({ theme });
	applyToDOM(theme);

	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		if (useThemeStore.getState().theme === "system") applyToDOM("system");
	});
}

export function useResolvedTheme(): "light" | "dark" {
	const theme = useThemeStore((s) => s.theme);
	const [systemDark, setSystemDark] = useState(() => (typeof window === "undefined" ? false : getSystemDark()));

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	if (theme === "dark") return "dark";
	if (theme === "light") return "light";
	return systemDark ? "dark" : "light";
}
