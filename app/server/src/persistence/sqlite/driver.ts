import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

/**
 * Server persistence runs on Node in production, while the Bun test runner uses its
 * compatible SQLite binding. Bun's `Statement.get` returns `null` for a missing row
 * where Node returns `undefined`, so call sites must treat both as absent.
 */
export type DatabaseSync = NodeDatabaseSync;

export const DatabaseSync: typeof NodeDatabaseSync = process.versions.bun
	? ((await import("bun:sqlite")).Database as unknown as typeof NodeDatabaseSync)
	: (await import("node:sqlite")).DatabaseSync;
