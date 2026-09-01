import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { IntlProvider } from "react-intl";
import { desktop } from "@/lib/desktop";
import type { DesktopUiLocalePreference, DesktopUiLocaleSnapshot } from "../../shared/desktop-rpc";
import { desktopMessages } from "./catalog";

const DEFAULT_LOCALE_SNAPSHOT: DesktopUiLocaleSnapshot = { preference: "system", locale: "en" };

interface DesktopLocaleContextValue extends DesktopUiLocaleSnapshot {
	readonly setPreference: (preference: DesktopUiLocalePreference) => Promise<void>;
}

const DesktopLocaleContext = createContext<DesktopLocaleContextValue | undefined>(undefined);

export function LocaleProvider({
	initialSnapshot,
	children,
}: {
	readonly initialSnapshot: DesktopUiLocaleSnapshot;
	readonly children: ReactNode;
}) {
	const [snapshot, setSnapshot] = useState(initialSnapshot);
	const value = useMemo<DesktopLocaleContextValue>(
		() => ({
			...snapshot,
			async setPreference(preference) {
				const nextSnapshot = await desktop.locale.set(preference);
				setSnapshot(nextSnapshot);
			},
		}),
		[snapshot],
	);

	useEffect(() => {
		document.documentElement.lang = snapshot.locale;
	}, [snapshot.locale]);

	return (
		<DesktopLocaleContext.Provider value={value}>
			<IntlProvider locale={snapshot.locale} messages={desktopMessages[snapshot.locale]} defaultLocale="en">
				{children}
			</IntlProvider>
		</DesktopLocaleContext.Provider>
	);
}

export function useDesktopLocale(): DesktopLocaleContextValue {
	const value = useContext(DesktopLocaleContext);
	if (!value) throw new Error("useDesktopLocale must be used within LocaleProvider");
	return value;
}

export async function initLocale(): Promise<DesktopUiLocaleSnapshot> {
	return desktop.locale.get().catch(() => DEFAULT_LOCALE_SNAPSHOT);
}
