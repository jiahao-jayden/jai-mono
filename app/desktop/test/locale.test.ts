import { describe, expect, test } from "bun:test";
import {
	createLocaleService,
	resolveDesktopUiLocale,
	type DesktopLocaleStore,
} from "../shared/locale";
import type { DesktopUiLocalePreference } from "../shared/desktop-rpc";

function memoryStore(initial: DesktopUiLocalePreference): DesktopLocaleStore {
	let preference = initial;
	return {
		get() {
			return preference;
		},
		set(_key, value) {
			preference = value;
		},
	};
}

describe("Desktop UI Locale", () => {
	test("resolves supported system locales and falls back to English", () => {
		expect(resolveDesktopUiLocale("system", "zh-CN")).toBe("zh-CN");
		expect(resolveDesktopUiLocale("system", "zh-Hans")).toBe("zh-CN");
		expect(resolveDesktopUiLocale("system", "en-US")).toBe("en");
		expect(resolveDesktopUiLocale("system", "ja-JP")).toBe("en");
	});

	test("persists the preference while resolving the effective locale", () => {
		const store = memoryStore("system");
		const service = createLocaleService({ store, systemLocale: () => "zh-CN" });

		expect(service.get()).toEqual({ preference: "system", locale: "zh-CN" });
		expect(service.set("en")).toEqual({ preference: "en", locale: "en" });
		expect(service.get()).toEqual({ preference: "en", locale: "en" });
	});
});
