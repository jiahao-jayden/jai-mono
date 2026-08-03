import { ModelCatalogStore } from "@jai/coding/runtime";
import { mainLog } from "./logger";

export const desktopModelCatalog = new ModelCatalogStore({
	onUpdate() {
		mainLog.info("Models.dev catalog cache updated");
	},
});

export async function startDesktopModelCatalog(): Promise<void> {
	try {
		await desktopModelCatalog.start();
	} catch (error) {
		// Catalog data is optional metadata. Provider profiles configured locally
		// must keep working if Models.dev is unreachable on startup.
		mainLog.warn("Models.dev catalog refresh failed:", error);
	}
}
