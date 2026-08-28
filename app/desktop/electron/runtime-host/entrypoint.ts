import { join } from "node:path";
import { app } from "electron";

/** Locates Desktop's standalone Runtime Host only after Forge has packaged it into Resources. */
export function resolveDesktopRuntimeHostEntrypoint(): string | undefined {
	if (!app.isPackaged) return undefined;
	return join(process.resourcesPath, "dist", "main.js");
}
