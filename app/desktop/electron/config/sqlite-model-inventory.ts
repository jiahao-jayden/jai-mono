import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TaggedError } from "better-result";
import type { ProviderModelInventory, ProviderModelInventoryStore } from "./model-inventory";

class ProviderModelInventoryInvalid extends TaggedError("desktop_provider_inventory.invalid_data")<{
	readonly message: string;
}> {}

/** SQLite implementation for Desktop's Provider model discovery cache. */
export class SqliteProviderModelInventoryStore implements ProviderModelInventoryStore {
	readonly #database: DatabaseSync;
	readonly #now: () => number;

	private constructor(database: DatabaseSync, now: () => number) {
		this.#database = database;
		this.#now = now;
		this.#database.exec("PRAGMA journal_mode = WAL");
		this.#database.exec("PRAGMA synchronous = NORMAL");
		this.#database.exec("PRAGMA busy_timeout = 5000");
		this.#database.exec(`
			CREATE TABLE IF NOT EXISTS provider_model_inventory (
				profile_id TEXT PRIMARY KEY,
				model_ids_json TEXT NOT NULL,
				fetched_at INTEGER NOT NULL
			);
		`);
	}

	static async open(
		databasePath: string,
		options: { readonly now?: () => number } = {},
	): Promise<SqliteProviderModelInventoryStore> {
		if (databasePath !== ":memory:") await mkdir(dirname(databasePath), { recursive: true });
		return new SqliteProviderModelInventoryStore(new DatabaseSync(databasePath), options.now ?? Date.now);
	}

	get(profileId: string): ProviderModelInventory | undefined {
		return mapInventory(
			this.#database
				.prepare(
					`SELECT profile_id, model_ids_json, fetched_at
					 FROM provider_model_inventory
					 WHERE profile_id = ?`,
				)
				.get(profileId),
		);
	}

	replace(profileId: string, modelIds: readonly string[]): ProviderModelInventory {
		const normalizedModelIds = uniqueModelIds(modelIds);
		this.#database
			.prepare(
				`INSERT INTO provider_model_inventory (profile_id, model_ids_json, fetched_at)
				 VALUES (?, ?, ?)
				 ON CONFLICT(profile_id) DO UPDATE SET
				  model_ids_json = excluded.model_ids_json,
				  fetched_at = excluded.fetched_at`,
			)
			.run(profileId, JSON.stringify(normalizedModelIds), this.#now());
		return this.get(profileId)!;
	}

	delete(profileId: string): void {
		this.#database.prepare("DELETE FROM provider_model_inventory WHERE profile_id = ?").run(profileId);
	}

	rename(fromProfileId: string, toProfileId: string): void {
		if (fromProfileId === toProfileId) return;
		this.#database.prepare("UPDATE provider_model_inventory SET profile_id = ? WHERE profile_id = ?").run(toProfileId, fromProfileId);
	}

	close(): void {
		this.#database.close();
	}
}

function mapInventory(value: unknown): ProviderModelInventory | undefined {
	if (value === undefined) return undefined;
	if (!isRow(value)) throw invalidData("Invalid provider model inventory row");
	const rawModelIds = stringColumn(value, "model_ids_json");
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawModelIds);
	} catch {
		throw invalidData("Invalid provider model inventory JSON");
	}
	if (!Array.isArray(parsed) || parsed.some((modelId) => typeof modelId !== "string")) {
		throw invalidData("Invalid provider model inventory model IDs");
	}
	return {
		profileId: stringColumn(value, "profile_id"),
		modelIds: uniqueModelIds(parsed),
		fetchedAt: numberColumn(value, "fetched_at"),
	};
}

function invalidData(message: string): ProviderModelInventoryInvalid {
	return new ProviderModelInventoryInvalid({ message });
}

function uniqueModelIds(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isRow(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringColumn(row: Record<string, unknown>, name: string): string {
	const value = row[name];
	if (typeof value !== "string") throw invalidData(`Invalid SQLite string column "${name}"`);
	return value;
}

function numberColumn(row: Record<string, unknown>, name: string): number {
	const value = row[name];
	if (typeof value !== "number") throw invalidData(`Invalid SQLite number column "${name}"`);
	return value;
}
