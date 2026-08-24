import { homedir } from "node:os";
import path from "node:path";

/** Shared durable root for every Jai host. JAI_HOME is the root itself, not its parent. */
export function defaultJaiHome(homeDirectory: string = homedir()): string {
	return path.resolve(process.env.JAI_HOME ?? path.join(homeDirectory, ".jai"));
}

export function jaiDatabasePath(jaiHome: string = defaultJaiHome()): string {
	return path.join(jaiHome, "data.sqlite");
}
