import { Models } from "@opencode-ai/models";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { DatabaseSync } from "../persistence/sqlite/driver";
import {
	normalizeRuntimeModelCatalog,
	parseRuntimeModelCatalog,
	RUNTIME_MODEL_CATALOG_FRESHNESS_MS,
	type RuntimeModelCatalog,
	type RuntimeModelCatalogSnapshot,
} from "./catalog";

export type RuntimeModelCatalogFetcher = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export class RuntimeModelCatalogReadFailed extends TaggedError("runtime_model_catalog.read_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeModelCatalogWriteFailed extends TaggedError("runtime_model_catalog.write_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeModelCatalogFetchFailed extends TaggedError("runtime_model_catalog.fetch_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type RuntimeModelCatalogError =
	| RuntimeModelCatalogReadFailed
	| RuntimeModelCatalogWriteFailed
	| RuntimeModelCatalogFetchFailed;

interface StoredModelCatalog {
	readonly catalog: RuntimeModelCatalog;
	readonly fetchedAt: number;
}

/**
 * The Host's one model-catalog module: normalized public metadata, stale-cache
 * semantics and its SQLite fact all sit behind get / refresh.
 */
export class SqliteRuntimeModelCatalog {
	readonly #fetcher: RuntimeModelCatalogFetcher;
	readonly #client: ReturnType<typeof Models.make>;
	readonly #now: () => number;
	#refreshing?: Promise<ResultType<RuntimeModelCatalogSnapshot, RuntimeModelCatalogError>>;
	#timer?: ReturnType<typeof setTimeout>;
	#closed = false;

	constructor(
		private readonly database: DatabaseSync,
		options: { readonly fetcher?: RuntimeModelCatalogFetcher; readonly now?: () => number } = {},
	) {
		this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
		this.#client = Models.make({ fetch: this.#fetcher as typeof globalThis.fetch });
		this.#now = options.now ?? Date.now;
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS runtime_model_catalog (
				key TEXT PRIMARY KEY CHECK (key = 'default'),
				catalog_json TEXT NOT NULL,
				etag TEXT,
				fetched_at INTEGER NOT NULL
			);
		`);
	}

	get(): ResultType<RuntimeModelCatalogSnapshot, RuntimeModelCatalogReadFailed> {
		const current = this.read();
		if (current.isErr()) return current;
		return Result.ok(snapshotFor(current.value, false, this.#now()));
	}

	async start(): Promise<ResultType<RuntimeModelCatalogSnapshot, RuntimeModelCatalogError>> {
		const refreshed = await this.refresh();
		this.schedule();
		return refreshed;
	}

	async refresh(): Promise<ResultType<RuntimeModelCatalogSnapshot, RuntimeModelCatalogError>> {
		if (this.#refreshing) return this.#refreshing;
		const request = this.refreshOnce();
		this.#refreshing = request;
		try {
			return await request;
		} finally {
			this.#refreshing = undefined;
			this.schedule();
		}
	}

	close(): void {
		this.#closed = true;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	private async refreshOnce(): Promise<ResultType<RuntimeModelCatalogSnapshot, RuntimeModelCatalogError>> {
		const current = this.read();
		if (current.isErr()) return current;
		if (current.value && isFresh(current.value, this.#now()))
			return Result.ok(snapshotFor(current.value, false, this.#now()));
		try {
			const catalog = normalizeRuntimeModelCatalog(
				await this.#client.catalog({ signal: AbortSignal.timeout(15_000) }),
			);
			const next = { catalog, fetchedAt: this.#now() };
			const saved = this.write(next);
			if (saved.isErr()) return saved;
			return Result.ok(snapshotFor(next, true, this.#now()));
		} catch (cause) {
			if (current.value) return Result.ok(snapshotFor(current.value, false, this.#now()));
			return Result.err(
				new RuntimeModelCatalogFetchFailed({ message: "Unable to fetch the Models.dev catalog", cause }),
			);
		}
	}

	private read(): ResultType<StoredModelCatalog | undefined, RuntimeModelCatalogReadFailed> {
		try {
			const row = this.database
				.prepare("SELECT catalog_json, fetched_at FROM runtime_model_catalog WHERE key = 'default'")
				.get() as unknown as { readonly catalog_json: string; readonly fetched_at: number } | undefined;
			if (!row) return Result.ok(undefined);
			const catalog = parseRuntimeModelCatalog(JSON.parse(row.catalog_json));
			if (!catalog || !Number.isInteger(row.fetched_at) || row.fetched_at < 0) {
				return Result.err(
					new RuntimeModelCatalogReadFailed({ message: "Runtime Model Catalog fact is corrupted" }),
				);
			}
			return Result.ok({ catalog, fetchedAt: row.fetched_at });
		} catch (cause) {
			return Result.err(
				new RuntimeModelCatalogReadFailed({ message: "Could not read Runtime Model Catalog", cause }),
			);
		}
	}

	private write(value: StoredModelCatalog): ResultType<void, RuntimeModelCatalogWriteFailed> {
		try {
			this.database
				.prepare(
					`INSERT INTO runtime_model_catalog (key, catalog_json, etag, fetched_at)
					 VALUES ('default', ?, NULL, ?)
					 ON CONFLICT(key) DO UPDATE SET
						catalog_json = excluded.catalog_json,
						etag = NULL,
						fetched_at = excluded.fetched_at`,
				)
				.run(JSON.stringify(value.catalog), value.fetchedAt);
			return Result.ok(undefined);
		} catch (cause) {
			return Result.err(
				new RuntimeModelCatalogWriteFailed({ message: "Could not persist Runtime Model Catalog", cause }),
			);
		}
	}

	private schedule(): void {
		if (this.#closed) return;
		if (this.#timer) clearTimeout(this.#timer);
		const current = this.read();
		if (current.isErr() || !current.value) return;
		const delay = Math.max(0, current.value.fetchedAt + RUNTIME_MODEL_CATALOG_FRESHNESS_MS - this.#now());
		this.#timer = setTimeout(() => {
			void this.refresh();
		}, delay);
		this.#timer.unref?.();
	}
}

function isFresh(value: StoredModelCatalog, now: number): boolean {
	return now - value.fetchedAt < RUNTIME_MODEL_CATALOG_FRESHNESS_MS;
}

function snapshotFor(
	value: StoredModelCatalog | undefined,
	refreshed: boolean,
	now: number,
): RuntimeModelCatalogSnapshot {
	return value
		? {
				catalog: structuredClone(value.catalog),
				fetchedAt: value.fetchedAt,
				stale: !isFresh(value, now),
				refreshed,
			}
		: { stale: false, refreshed };
}
