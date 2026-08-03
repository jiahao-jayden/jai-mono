import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";

const CATALOG_URL = "https://models.dev/catalog.json";
export const MODEL_CATALOG_FRESHNESS_MS = 48 * 60 * 60 * 1_000;

export type ModelCatalogModality = "text" | "image" | "audio" | "video" | "pdf";

export interface ModelCatalogCost {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly reasoning?: number;
}

export interface ModelCatalogModel {
	readonly id: string;
	readonly name: string;
	readonly reasoning: boolean;
	readonly toolCall: boolean;
	readonly structuredOutput: boolean;
	readonly inputModalities: readonly ModelCatalogModality[];
	readonly outputModalities: readonly ModelCatalogModality[];
	readonly cost: ModelCatalogCost;
	readonly contextWindow: number;
	readonly maxTokens: number;
}

export interface ModelCatalogProvider {
	readonly id: string;
	readonly name: string;
	readonly models: Readonly<Record<string, ModelCatalogModel>>;
}

export interface ModelCatalog {
	readonly providers: Readonly<Record<string, ModelCatalogProvider>>;
}

export interface CachedModelCatalog {
	readonly catalog: ModelCatalog;
	readonly etag?: string;
	readonly fetchedAt: number;
}

export interface ModelCatalogRefreshResult {
	readonly catalog?: ModelCatalog;
	readonly refreshed: boolean;
	readonly stale: boolean;
}

type CatalogFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ModelCatalogOptions {
	readonly cachePath?: string;
	readonly fetch?: CatalogFetch;
	readonly now?: () => number;
	readonly onUpdate?: (catalog: ModelCatalog) => void;
}

type ModelCatalogErrorInit = {
	readonly cause?: unknown;
	readonly data?: { readonly cachePath?: string; readonly status?: number };
	readonly message: string;
};

class ModelCatalogFetchFailed extends TaggedError("model_catalog.fetch_failed")<ModelCatalogErrorInit> {}
class ModelCatalogCacheWriteFailed extends TaggedError("model_catalog.cache_write_failed")<ModelCatalogErrorInit> {}

function modelCatalogError(reason: "fetch_failed" | "cache_write_failed", init: ModelCatalogErrorInit) {
	switch (reason) {
		case "fetch_failed":
			return new ModelCatalogFetchFailed(init);
		case "cache_write_failed":
			return new ModelCatalogCacheWriteFailed(init);
	}
}

const modalitySchema = Type.Union([
	Type.Literal("text"),
	Type.Literal("image"),
	Type.Literal("audio"),
	Type.Literal("video"),
	Type.Literal("pdf"),
]);

const modelCostSchema = Type.Object(
	{
		input: Type.Number(),
		output: Type.Number(),
		cacheRead: Type.Number(),
		cacheWrite: Type.Number(),
		reasoning: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

const catalogModelSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		name: Type.String({ minLength: 1 }),
		reasoning: Type.Boolean(),
		toolCall: Type.Boolean(),
		structuredOutput: Type.Boolean(),
		inputModalities: Type.Array(modalitySchema),
		outputModalities: Type.Array(modalitySchema),
		cost: modelCostSchema,
		contextWindow: Type.Integer({ minimum: 1 }),
		maxTokens: Type.Integer({ minimum: 1 }),
	},
	{ additionalProperties: false },
);

const catalogProviderSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		name: Type.String({ minLength: 1 }),
		models: Type.Record(Type.String({ minLength: 1 }), catalogModelSchema),
	},
	{ additionalProperties: false },
);

const modelCatalogSchema = Type.Object(
	{
		providers: Type.Record(Type.String({ minLength: 1 }), catalogProviderSchema),
	},
	{ additionalProperties: false },
);

const cachedCatalogSchema = Type.Object(
	{
		catalog: modelCatalogSchema,
		etag: Type.Optional(Type.String({ minLength: 1 })),
		fetchedAt: Type.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

const externalCatalogEnvelopeSchema = Type.Object(
	{
		providers: Type.Record(
			Type.String({ minLength: 1 }),
			Type.Object(
				{
					models: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
					name: Type.Optional(Type.String({ minLength: 1 })),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);

const externalModelSchema = Type.Object(
	{
		name: Type.Optional(Type.String({ minLength: 1 })),
		reasoning: Type.Optional(Type.Boolean()),
		tool_call: Type.Optional(Type.Boolean()),
		structured_output: Type.Optional(Type.Boolean()),
		modalities: Type.Optional(
			Type.Object(
				{
					input: Type.Optional(Type.Array(Type.String())),
					output: Type.Optional(Type.Array(Type.String())),
				},
				{ additionalProperties: true },
			),
		),
		cost: Type.Optional(
			Type.Object(
				{
					input: Type.Optional(Type.Number()),
					output: Type.Optional(Type.Number()),
					cache_read: Type.Optional(Type.Number()),
					cache_write: Type.Optional(Type.Number()),
					reasoning: Type.Optional(Type.Number()),
				},
				{ additionalProperties: true },
			),
		),
		limit: Type.Optional(
			Type.Object(
				{
					context: Type.Optional(Type.Integer({ minimum: 1 })),
					output: Type.Optional(Type.Integer({ minimum: 1 })),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);
type ExternalCatalogModel = Static<typeof externalModelSchema>;

/**
 * Non-sensitive Models.dev catalog cache. It never sees or stores provider
 * credentials, endpoints, headers, or application configuration.
 */
export class ModelCatalogStore {
	readonly #cachePath: string;
	readonly #fetch: CatalogFetch;
	readonly #now: () => number;
	readonly #onUpdate?: (catalog: ModelCatalog) => void;
	#cached?: CachedModelCatalog;
	#refreshing?: Promise<ModelCatalogRefreshResult>;
	#timer?: ReturnType<typeof setTimeout>;
	#nextRefreshAt?: number;

	constructor(options: ModelCatalogOptions = {}) {
		this.#cachePath = options.cachePath ?? join(homedir(), ".jai", "cache", "models.dev.json");
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#now = options.now ?? Date.now;
		this.#onUpdate = options.onUpdate;
	}

	get cachePath(): string {
		return this.#cachePath;
	}

	get cached(): CachedModelCatalog | undefined {
		return this.#cached;
	}

	async start(): Promise<ModelCatalogRefreshResult> {
		this.#cached ??= await this.#readCache();
		const cached = this.#cached;
		const stale = !cached || !isFresh(cached, this.#now());
		const result = stale ? await this.refresh() : toCachedResult(cached, false, this.#now());
		this.#schedule();
		return result;
	}

	async refresh(): Promise<ModelCatalogRefreshResult> {
		if (this.#refreshing) return this.#refreshing;
		const request = this.#refresh();
		this.#refreshing = request;
		try {
			return await request;
		} finally {
			this.#refreshing = undefined;
			this.#schedule();
		}
	}

	close(): void {
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	async #refresh(): Promise<ModelCatalogRefreshResult> {
		this.#cached ??= await this.#readCache();
		try {
			const headers = new Headers({ accept: "application/json" });
			if (this.#cached?.etag) headers.set("if-none-match", this.#cached.etag);
			const response = await this.#fetch(CATALOG_URL, { headers, signal: AbortSignal.timeout(15_000) });
			if (response.status === 304 && this.#cached) {
				const next = { ...this.#cached, fetchedAt: this.#now() };
				await this.#writeCache(next);
				this.#cached = next;
				this.#nextRefreshAt = next.fetchedAt + MODEL_CATALOG_FRESHNESS_MS;
				return toCachedResult(next, true, this.#now());
			}
			if (!response.ok) {
				throw modelCatalogError("fetch_failed", {
					message: `Models.dev catalog request failed with HTTP ${response.status}`,
					data: { status: response.status },
				});
			}
			const catalog = normalizeModelCatalog(await response.json());
			const etag = response.headers.get("etag") ?? undefined;
			const next = { catalog, ...(etag ? { etag } : {}), fetchedAt: this.#now() };
			await this.#writeCache(next);
			this.#cached = next;
			this.#nextRefreshAt = next.fetchedAt + MODEL_CATALOG_FRESHNESS_MS;
			this.#onUpdate?.(catalog);
			return toCachedResult(next, true, this.#now());
		} catch (error) {
			if (this.#cached) {
				this.#nextRefreshAt = this.#now() + MODEL_CATALOG_FRESHNESS_MS;
				return { catalog: this.#cached.catalog, refreshed: false, stale: true };
			}
			if (error instanceof ModelCatalogFetchFailed || error instanceof ModelCatalogCacheWriteFailed) throw error;
			throw modelCatalogError("fetch_failed", {
				message: "Unable to fetch the Models.dev catalog",
				cause: error,
			});
		}
	}

	#schedule(): void {
		if (this.#timer) clearTimeout(this.#timer);
		if (!this.#cached) return;
		const dueAt = this.#nextRefreshAt ?? this.#cached.fetchedAt + MODEL_CATALOG_FRESHNESS_MS;
		const delay = Math.max(0, dueAt - this.#now());
		this.#timer = setTimeout(() => {
			void this.refresh();
		}, delay);
		this.#timer.unref?.();
	}

	async #readCache(): Promise<CachedModelCatalog | undefined> {
		try {
			const raw: unknown = JSON.parse(await readFile(this.#cachePath, "utf8"));
			return Value.Check(cachedCatalogSchema, raw) ? raw : undefined;
		} catch {
			return undefined;
		}
	}

	async #writeCache(value: CachedModelCatalog): Promise<void> {
		const temporaryPath = `${this.#cachePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
		try {
			await mkdir(dirname(this.#cachePath), { recursive: true, mode: 0o700 });
			await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
			await rename(temporaryPath, this.#cachePath);
			await chmod(this.#cachePath, 0o600);
		} catch (error) {
			throw modelCatalogError("cache_write_failed", {
				message: `Unable to write Models.dev cache at ${this.#cachePath}`,
				data: { cachePath: this.#cachePath },
				cause: error,
			});
		}
	}
}

export function normalizeModelCatalog(value: unknown): ModelCatalog {
	if (!Value.Check(externalCatalogEnvelopeSchema, value)) {
		throw modelCatalogError("fetch_failed", { message: "Models.dev catalog has an unsupported shape" });
	}
	const providers = Object.fromEntries(
		Object.entries(value.providers).flatMap(([providerId, rawProvider]) => {
			const models = Object.fromEntries(
				Object.entries(rawProvider.models).flatMap(([modelId, rawModel]) => {
					if (!Value.Check(externalModelSchema, rawModel)) return [];
					return [[modelId, normalizeModel(modelId, rawModel)]];
				}),
			);
			return [[providerId, { id: providerId, name: rawProvider.name ?? providerId, models }]];
		}),
	);
	const catalog = { providers };
	if (!Value.Check(modelCatalogSchema, catalog)) {
		throw modelCatalogError("fetch_failed", { message: "Models.dev catalog normalization failed" });
	}
	return catalog;
}

export function findCatalogModel(
	catalog: ModelCatalog | undefined,
	providerId: string | undefined,
	modelId: string,
): ModelCatalogModel | undefined {
	if (!catalog || !providerId) return undefined;
	return catalog.providers[providerId]?.models[modelId];
}

function normalizeModel(id: string, value: ExternalCatalogModel): ModelCatalogModel {
	const inputModalities = normalizeModalities(value.modalities?.input);
	const outputModalities = normalizeModalities(value.modalities?.output);
	return {
		id,
		name: value.name ?? id,
		reasoning: value.reasoning ?? false,
		toolCall: value.tool_call ?? false,
		structuredOutput: value.structured_output ?? false,
		inputModalities: inputModalities.length > 0 ? inputModalities : ["text"],
		outputModalities: outputModalities.length > 0 ? outputModalities : ["text"],
		cost: {
			input: value.cost?.input ?? 0,
			output: value.cost?.output ?? 0,
			cacheRead: value.cost?.cache_read ?? 0,
			cacheWrite: value.cost?.cache_write ?? 0,
			...(value.cost?.reasoning === undefined ? {} : { reasoning: value.cost.reasoning }),
		},
		contextWindow: value.limit?.context ?? 128_000,
		maxTokens: value.limit?.output ?? 4_096,
	};
}

function normalizeModalities(values: readonly string[] | undefined): ModelCatalogModality[] {
	if (!values) return [];
	return [...new Set(values.filter(isCatalogModality))];
}

function isCatalogModality(value: string): value is ModelCatalogModality {
	return value === "text" || value === "image" || value === "audio" || value === "video" || value === "pdf";
}

function isFresh(cached: CachedModelCatalog, now: number): boolean {
	return now - cached.fetchedAt < MODEL_CATALOG_FRESHNESS_MS;
}

function toCachedResult(cached: CachedModelCatalog, refreshed: boolean, now = Date.now()): ModelCatalogRefreshResult {
	return {
		catalog: cached.catalog,
		refreshed,
		stale: !isFresh(cached, now),
	};
}
