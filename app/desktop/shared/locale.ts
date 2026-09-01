import { TaggedError } from "better-result";
import type {
	DesktopUiLocale,
	DesktopUiLocalePreference,
	DesktopUiLocaleSnapshot,
} from "./desktop-rpc";

class InvalidDesktopUiLocale extends TaggedError("desktop_locale.invalid_preference")<{
	readonly message: string;
}> {}

export interface DesktopLocaleStore {
	get(key: "preference"): DesktopUiLocalePreference | undefined;
	set(key: "preference", value: DesktopUiLocalePreference): void;
}

export interface DesktopLocaleService {
	get(): DesktopUiLocaleSnapshot;
	set(preference: DesktopUiLocalePreference): DesktopUiLocaleSnapshot;
}

export function isDesktopUiLocalePreference(value: unknown): value is DesktopUiLocalePreference {
	return value === "system" || value === "en" || value === "zh-CN";
}

export function resolveDesktopUiLocale(preference: DesktopUiLocalePreference, systemLocale: string): DesktopUiLocale {
	if (preference !== "system") return preference;
	const normalized = systemLocale.toLowerCase();
	return normalized === "zh" || normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans") ? "zh-CN" : "en";
}

export function createLocaleService(options: {
	readonly store: DesktopLocaleStore;
	readonly systemLocale: () => string;
}): DesktopLocaleService {
	const snapshot = (): DesktopUiLocaleSnapshot => {
		const preference = options.store.get("preference") ?? "system";
		return { preference, locale: resolveDesktopUiLocale(preference, options.systemLocale()) };
	};

	return {
		get: snapshot,
		set(preference) {
			if (!isDesktopUiLocalePreference(preference)) {
				throw new InvalidDesktopUiLocale({ message: "Desktop UI locale preference is invalid" });
			}
			options.store.set("preference", preference);
			return snapshot();
		},
	};
}
