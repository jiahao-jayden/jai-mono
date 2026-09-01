import { app } from "electron";
import Store from "electron-store";
import type { DesktopUiLocalePreference } from "../shared/desktop-rpc";
import { createLocaleService, type DesktopLocaleService } from "../shared/locale";

export type { DesktopLocaleService } from "../shared/locale";

export function createDesktopLocaleService(): DesktopLocaleService {
	const store = new Store<{ preference: DesktopUiLocalePreference }>({ defaults: { preference: "system" } });
	return createLocaleService({
		store,
		systemLocale: () => app.getLocale(),
	});
}
