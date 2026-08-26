import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The Server owns Jai's product data-root convention. Clients may override it
 * for an isolated profile, but never derive a separate durable database path.
 */
export function resolveJaiDataDirectory(
	environment: Readonly<Record<string, string | undefined>> = process.env,
	homeDirectory: string = homedir(),
): string {
	return resolve(environment.JAI_HOME ?? join(homeDirectory, ".jai"));
}
