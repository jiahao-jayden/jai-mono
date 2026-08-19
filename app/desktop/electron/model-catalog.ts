import { ModelCatalogStore } from "@jai/coding-agent/jai-host";
import { mainLog } from "./logger";

let onCatalogUpdated: (() => void) | undefined;

export const desktopModelCatalog = new ModelCatalogStore({
	onUpdate() {
		mainLog.info("Models.dev catalog cache updated");
		onCatalogUpdated?.();
	},
});

export function setDesktopModelCatalogUpdateListener(listener: () => void): void {
	onCatalogUpdated = listener;
}

export async function hydrateDesktopModelCatalog(): Promise<void> {
	await desktopModelCatalog.hydrate();
}

export async function startDesktopModelCatalog(): Promise<void> {
	try {
		await desktopModelCatalog.start();
	} catch (error) {
		// Catalog data is optional metadata. Provider profiles configured locally
		// must keep working if Models.dev is unreachable on startup.
		mainLog.warn("Models.dev catalog refresh failed:", error);
	}
}
