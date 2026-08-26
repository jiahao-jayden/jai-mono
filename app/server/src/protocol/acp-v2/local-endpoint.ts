import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Resolves the private socket/pipe endpoint for one Jai data directory. */
export function localAcpV2EndpointFor(dataDirectory: string): string {
	const identity = createHash("sha256").update(dataDirectory).digest("hex").slice(0, 20);
	if (process.platform === "win32") return `\\\\.\\pipe\\jai-runtime-${identity}`;
	return join(tmpdir(), `jai-runtime-${identity}.sock`);
}
