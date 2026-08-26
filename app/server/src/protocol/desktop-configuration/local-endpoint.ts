import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Resolves the private Desktop configuration endpoint for one Jai data directory. */
export function localDesktopConfigurationEndpointFor(dataDirectory: string): string {
	const identity = createHash("sha256").update(dataDirectory).digest("hex").slice(0, 20);
	if (process.platform === "win32") return `\\\\.\\pipe\\jai-desktop-configuration-${identity}`;
	return join(tmpdir(), `jai-desktop-configuration-${identity}.sock`);
}
