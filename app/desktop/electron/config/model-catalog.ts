import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import { findDefaultProviderVendor } from "./provider-vendors";

const CATALOG_URL = "https://models.dev/catalog.json";
export const MODEL_CATALOG_FRESHNESS_MS = 48 * 60 * 60 * 1_000;

export type ModelCatalogModality = "text" | "image" | "audio" | "video" | "pdf";

export interface ModelCatalogCost {
	readonly input?: number;
	readonly output?: number;
	readonly cacheRead?: number;
	readonly cacheWrite?: number;
	readonly reasoning?: number;
}

export interface ModelCatalogModel {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly family?: string;
	readonly status?: string;
	readonly releaseDate?: string;
	readonly lastUpdated?: string;
	readonly knowledge?: string;
	readonly openWeights?: boolean;
	readonly attachment?: boolean;
	readonly reasoning?: boolean;
	readonly reasoningOptions?: readonly string[];
	readonly temperature?: boolean;
	readonly interleaved?: true | { readonly field: "reasoning" | "reasoning_content" | "reasoning_details" };
	readonly toolCall?: boolean;
	readonly structuredOutput?: boolean;
	readonly inputModalities?: readonly ModelCatalogModality[];
	readonly outputModalities?: readonly ModelCatalogModality[];
	readonly cost?: ModelCatalogCost;
	readonly contextWindow?: number;
	readonly inputLimit?: number;
	readonly maxTokens?: number;
}

export interface ModelCatalogProvider {
	readonly id: string;
	readonly name: string;
	readonly models: Readonly<Record<string, ModelCatalogModel>>;
}

export interface ModelCatalog {
	readonly providers: Readonly<Record<string, ModelCatalogProvider>>;
}

export interface ModelCatalogMatch {
	readonly providerId: string;
	readonly model: ModelCatalogModel;
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
		input: Type.Optional(Type.Number()),
		output: Type.Optional(Type.Number()),
		cacheRead: Type.Optional(Type.Number()),
		cacheWrite: Type.Optional(Type.Number()),
		reasoning: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

const catalogModelSchema = Type.Object(
	{
		id: Type.String({ minLength: 1 }),
		name: Type.String({ minLength: 1 }),
		description: Type.Optional(Type.String({ minLength: 1 })),
		family: Type.Optional(Type.String({ minLength: 1 })),
		status: Type.Optional(Type.String({ minLength: 1 })),
		releaseDate: Type.Optional(Type.String({ minLength: 1 })),
		lastUpdated: Type.Optional(Type.String({ minLength: 1 })),
		knowledge: Type.Optional(Type.String({ minLength: 1 })),
		openWeights: Type.Optional(Type.Boolean()),
		attachment: Type.Optional(Type.Boolean()),
		reasoning: Type.Optional(Type.Boolean()),
		reasoningOptions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		temperature: Type.Optional(Type.Boolean()),
		interleaved: Type.Optional(
			Type.Union([
				Type.Literal(true),
				Type.Object(
					{
						field: Type.Union([
							Type.Literal("reasoning"),
							Type.Literal("reasoning_content"),
							Type.Literal("reasoning_details"),
						]),
					},
					{ additionalProperties: false },
				),
			]),
		),
		toolCall: Type.Optional(Type.Boolean()),
		structuredOutput: Type.Optional(Type.Boolean()),
		inputModalities: Type.Optional(Type.Array(modalitySchema)),
		outputModalities: Type.Optional(Type.Array(modalitySchema)),
		cost: Type.Optional(modelCostSchema),
		contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
		inputLimit: Type.Optional(Type.Integer({ minimum: 1 })),
		maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
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
		description: Type.Optional(Type.String({ minLength: 1 })),
		family: Type.Optional(Type.String({ minLength: 1 })),
		status: Type.Optional(Type.String({ minLength: 1 })),
		release_date: Type.Optional(Type.String({ minLength: 1 })),
		last_updated: Type.Optional(Type.String({ minLength: 1 })),
		knowledge: Type.Optional(Type.String({ minLength: 1 })),
		open_weights: Type.Optional(Type.Boolean()),
		attachment: Type.Optional(Type.Boolean()),
		reasoning: Type.Optional(Type.Boolean()),
		reasoning_options: Type.Optional(
			Type.Array(
				Type.Union([
					Type.String({ minLength: 1 }),
					Type.Object(
						{
							type: Type.String({ minLength: 1 }),
							values: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
						},
						{ additionalProperties: true },
					),
				]),
			),
		),
		temperature: Type.Optional(Type.Boolean()),
		tool_call: Type.Optional(Type.Boolean()),
		structured_output: Type.Optional(Type.Boolean()),
		interleaved: Type.Optional(
			Type.Union([
				Type.Literal(true),
				Type.Object(
					{
						field: Type.Union([
							Type.Literal("reasoning"),
							Type.Literal("reasoning_content"),
							Type.Literal("reasoning_details"),
						]),
					},
					{ additionalProperties: true },
				),
			]),
		),
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
					input: Type.Optional(Type.Integer({ minimum: 1 })),
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

	async hydrate(): Promise<void> {
		this.#cached ??= await this.#readCache();
	}

	async start(): Promise<ModelCatalogRefreshResult> {
		await this.hydrate();
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
	return findCatalogModelMatch(catalog, providerId, modelId)?.model;
}

/**
 * An explicit endpoint mapping wins. Well-known model families then resolve
 * to their first-party Models.dev vendor; all other IDs need a unique catalog
 * entry so proxy-gateway metadata is never selected arbitrarily.
 */
export function findCatalogModelMatch(
	catalog: ModelCatalog | undefined,
	preferredProviderId: string | undefined,
	modelId: string,
): ModelCatalogMatch | undefined {
	if (!catalog) return undefined;
	const preferredModel = preferredProviderId ? catalog.providers[preferredProviderId]?.models[modelId] : undefined;
	if (preferredProviderId && preferredModel) return { providerId: preferredProviderId, model: preferredModel };

	const defaultVendor = findDefaultProviderVendor(modelId);
	const defaultModel = defaultVendor ? catalog.providers[defaultVendor.catalogProvider]?.models[modelId] : undefined;
	if (defaultVendor && defaultModel) return { providerId: defaultVendor.catalogProvider, model: defaultModel };

	const matches = Object.entries(catalog.providers).flatMap(([providerId, provider]) => {
		const model = provider.models[modelId];
		return model ? [{ providerId, model }] : [];
	});
	return matches.length === 1 ? matches[0] : undefined;
}

function normalizeModel(id: string, value: ExternalCatalogModel): ModelCatalogModel {
	const inputModalities = normalizeModalities(value.modalities?.input);
	const outputModalities = normalizeModalities(value.modalities?.output);
	const cost = normalizeCost(value.cost);
	return {
		id,
		name: value.name ?? id,
		...(value.description ? { description: value.description } : {}),
		...(value.family ? { family: value.family } : {}),
		...(value.status ? { status: value.status } : {}),
		...(value.release_date ? { releaseDate: value.release_date } : {}),
		...(value.last_updated ? { lastUpdated: value.last_updated } : {}),
		...(value.knowledge ? { knowledge: value.knowledge } : {}),
		...(value.open_weights === undefined ? {} : { openWeights: value.open_weights }),
		...(value.attachment === undefined ? {} : { attachment: value.attachment }),
		...(value.reasoning === undefined ? {} : { reasoning: value.reasoning }),
		...(value.reasoning_options ? { reasoningOptions: normalizeReasoningOptions(value.reasoning_options) } : {}),
		...(value.temperature === undefined ? {} : { temperature: value.temperature }),
		...(value.interleaved === undefined ? {} : { interleaved: value.interleaved }),
		...(value.tool_call === undefined ? {} : { toolCall: value.tool_call }),
		...(value.structured_output === undefined ? {} : { structuredOutput: value.structured_output }),
		...(inputModalities.length > 0 ? { inputModalities } : {}),
		...(outputModalities.length > 0 ? { outputModalities } : {}),
		...(cost ? { cost } : {}),
		...(value.limit?.context === undefined ? {} : { contextWindow: value.limit.context }),
		...(value.limit?.input === undefined ? {} : { inputLimit: value.limit.input }),
		...(value.limit?.output === undefined ? {} : { maxTokens: value.limit.output }),
	};
}

function normalizeReasoningOptions(value: NonNullable<ExternalCatalogModel["reasoning_options"]>): string[] {
	return [...new Set(value.flatMap((option) => (typeof option === "string" ? [option] : (option.values ?? []))))];
}

function normalizeCost(value: ExternalCatalogModel["cost"]): ModelCatalogCost | undefined {
	if (!value) return undefined;
	const cost = {
		...(value.input === undefined ? {} : { input: value.input }),
		...(value.output === undefined ? {} : { output: value.output }),
		...(value.cache_read === undefined ? {} : { cacheRead: value.cache_read }),
		...(value.cache_write === undefined ? {} : { cacheWrite: value.cache_write }),
		...(value.reasoning === undefined ? {} : { reasoning: value.reasoning }),
	};
	return Object.keys(cost).length > 0 ? cost : undefined;
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

