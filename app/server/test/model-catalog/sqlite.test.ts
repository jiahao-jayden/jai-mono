import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "../../src/persistence/sqlite/driver";
import {
	findRuntimeModelCatalogMatch,
	normalizeRuntimeModelCatalog,
	RUNTIME_MODEL_CATALOG_FRESHNESS_MS,
	SqliteRuntimeModelCatalog,
} from "../../src";
import { parseRuntimeModelCatalogSnapshot, resolveRuntimeModelCatalogMatch } from "../../src/model-catalog/catalog";
import { resolveRuntimeModelCompatibilityProfile, resolveRuntimeModelMetadata } from "../../src/model-catalog";

describe("Runtime Model Catalog", () => {
	test("normalizes only allowlisted public metadata and retains deterministic model matching", () => {
		const catalog = normalizeRuntimeModelCatalog(rawCatalog());
		const model = catalog.providers.openai?.models["gpt-test"];
		expect(model).toEqual({
			id: "gpt-test",
			name: "GPT Test",
			family: "gpt",
			status: "active",
			releaseDate: "2025-08-07",
			lastUpdated: "2026-01-02",
			knowledge: "2024-06",
			openWeights: false,
			attachment: true,
			reasoning: true,
			reasoningOptions: ["low", "high"],
			temperature: false,
			interleaved: { field: "reasoning_content" },
			toolCall: true,
			structuredOutput: true,
			inputModalities: ["text", "image"],
			outputModalities: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, reasoning: 3 },
			contextWindow: 200_000,
			inputLimit: 150_000,
			maxTokens: 16_000,
		});
		expect(JSON.stringify(model)).not.toContain("must not persist");
		const stored = JSON.parse(JSON.stringify(catalog));
		expect(parseRuntimeModelCatalogSnapshot({ catalog: stored, fetchedAt: 1, stale: false, refreshed: false })).toBeDefined();
		stored.providers.openai.models["gpt-test"].credentials = "leaked";
		expect(parseRuntimeModelCatalogSnapshot({ catalog: stored, fetchedAt: 1, stale: false, refreshed: false })).toBeUndefined();
		expect(parseRuntimeModelCatalogSnapshot({ fetchedAt: 1, stale: false, refreshed: false })).toBeUndefined();
		expect(findRuntimeModelCatalogMatch(catalog, undefined, "gpt-test")).toMatchObject({
			providerId: "openai",
			model: { name: "GPT Test" },
		});
	});

	test("merges the flat Models.dev catalog and requires exact model IDs", () => {
		const catalog = normalizeRuntimeModelCatalog({
			providers: {
				deepseek: {
					name: "DeepSeek",
					models: {
						"deepseek-v4-flash": { name: "Current DeepSeek V4 Flash", release_date: "2026-09-10" },
					},
				},
			},
			models: {
				"deepseek/deepseek-v3-0324": { name: "DeepSeek V3 0324", release_date: "2025-03-24" },
			},
		});

		expect(findRuntimeModelCatalogMatch(catalog, undefined, "deepseek-v3-0324")?.model.name).toBe("DeepSeek V3 0324");
		expect(findRuntimeModelCatalogMatch(catalog, undefined, "deepseek-v3-250324")).toBeUndefined();
	});

	test("uses an explicit provider authority when a model ID is ambiguous", () => {
		const catalog = normalizeRuntimeModelCatalog({
			providers: {
				deepseek: {
					name: "DeepSeek",
					models: {
						"shared-model": {
							name: "DeepSeek V4 Flash",
							limit: { context: 128_000, output: 16_000 },
						},
					},
				},
				volcengine: {
					name: "Volcengine Ark",
					models: {
						"shared-model": {
							name: "DeepSeek V4 Flash GA",
							limit: { context: 1_000_000, output: 384_000 },
						},
					},
				},
			},
		});

		expect(findRuntimeModelCatalogMatch(catalog, undefined, "shared-model")).toBeUndefined();
		expect(findRuntimeModelCatalogMatch(catalog, "volcengine", "shared-model")).toMatchObject({
			providerId: "volcengine",
			model: { contextWindow: 1_000_000, maxTokens: 384_000 },
		});
		expect(resolveRuntimeModelCatalogMatch(catalog, undefined, "shared-model")).toEqual({
			kind: "ambiguous",
			providerIds: ["deepseek", "volcengine"],
		});
		expect(resolveRuntimeModelCatalogMatch(catalog, "volcengine", "shared-model")).toMatchObject({ kind: "exact" });
	});

	test("matches a Volcengine list ID to the dated catalog revision", () => {
		const catalog = normalizeRuntimeModelCatalog({
			providers: {
				deepseek: {
					name: "DeepSeek",
					models: {
						"deepseek-v4-1-flash": {
							name: "DeepSeek V4.1 Flash",
							limit: { context: 1_000_000, output: 384_000 },
						},
						"deepseek-v4-flash": {
							name: "DeepSeek V4 Flash",
							limit: { context: 128_000, output: 16_000 },
						},
					},
				},
				volcengine: {
					name: "Volcengine Ark",
					models: {
						"deepseek-v4-flash-ga-260731": {
							name: "DeepSeek V4 Flash GA",
							limit: { context: 1_000_000, output: 384_000 },
						},
						"deepseek-v4-pro-ga-260813": {
							name: "DeepSeek V4 Pro GA",
							limit: { context: 1_000_000, output: 384_000 },
						},
					},
				},
			},
		});

		expect(findRuntimeModelCatalogMatch(catalog, undefined, "deepseek-v4-flash")).toMatchObject({
			providerId: "deepseek",
			model: { contextWindow: 128_000 },
		});
		expect(findRuntimeModelCatalogMatch(catalog, "volcengine", "deepseek-v4-flash")).toMatchObject({
			providerId: "volcengine",
			model: { id: "deepseek-v4-flash-ga-260731", contextWindow: 1_000_000 },
		});
		expect(findRuntimeModelCatalogMatch(catalog, "volcengine", "deepseek-v4-pro")).toMatchObject({
			providerId: "volcengine",
			model: { id: "deepseek-v4-pro-ga-260813", contextWindow: 1_000_000 },
		});
		expect(findRuntimeModelCatalogMatch(catalog, "volcengine", "deepseek-v4-1-flash")).toBeUndefined();
		expect(findRuntimeModelCatalogMatch(catalog, "volcengine", "deepseek-v3-1-terminus")).toBeUndefined();
		expect(resolveRuntimeModelCatalogMatch(catalog, "volcengine", "deepseek-v4-flash")).toMatchObject({ kind: "revision" });
		expect(resolveRuntimeModelCatalogMatch(catalog, "volcengine", "deepseek-v4-1-flash")).toEqual({ kind: "unknown" });
	});

	test("does not fold a product variant into its base model when stripping revisions", () => {
		const catalog = normalizeRuntimeModelCatalog({
			providers: { volcengine: { models: { "glm-5-3-flash-260828": { name: "GLM-5.3-Flash" } } } },
		});
		expect(findRuntimeModelCatalogMatch(catalog, "volcengine", "glm-5-3-260814")).toBeUndefined();
		expect(findRuntimeModelCatalogMatch(catalog, "volcengine", "glm-5-3-flash-260826")).toMatchObject({
			model: { id: "glm-5-3-flash-260828" },
		});
	});

	test("freezes exact catalog identity and leaves revision and ambiguity unknown", () => {
		const catalog = normalizeRuntimeModelCatalog({
			providers: {
				openai: { models: { "gpt-test": { family: "gpt", interleaved: { field: "reasoning" } } } },
				gateway: { models: { "shared": { family: "shared-a" } } },
				other: { models: { "shared": { family: "shared-b" } } },
			},
		});
		const exact = resolveRuntimeModelCompatibilityProfile("openai/gpt-test", undefined, {
			catalog,
			stale: false,
			refreshed: false,
		});
		if (exact.isErr()) throw exact.error;
		expect(exact.value).toMatchObject({
			identity: { provider: "openai", remoteModelId: "gpt-test", family: "gpt" },
			rules: { reasoningFormat: "openai" },
		});
		const custom = resolveRuntimeModelCompatibilityProfile("gateway/gpt-test", undefined, {
			catalog,
			stale: false,
			refreshed: false,
		});
		if (custom.isErr()) throw custom.error;
		expect(custom.value.identity.family).toBeUndefined();

		const unknown = resolveRuntimeModelCompatibilityProfile("openai/gpt-test-2026", undefined, {
			catalog,
			stale: false,
			refreshed: false,
		});
		if (unknown.isErr()) throw unknown.error;
		expect(unknown.value.identity.family).toBeUndefined();

		const ambiguous = resolveRuntimeModelCompatibilityProfile("openai/shared", undefined, {
			catalog,
			stale: false,
			refreshed: false,
		});
		if (ambiguous.isErr()) throw ambiguous.error;
		expect(ambiguous.value.identity.family).toBeUndefined();
	});

	test("inherits a confirmed DeepSeek family policy through a Volcengine model identity", () => {
		const catalog = normalizeRuntimeModelCatalog({
			providers: {
				volcengine: {
					models: {
						"deepseek-v4-1-flash": {
							family: "deepseek-v4",
							reasoning: true,
							interleaved: { field: "reasoning_content" },
						},
					},
				},
			},
		});
		const result = resolveRuntimeModelCompatibilityProfile("volcengine/deepseek-v4-1-flash", undefined, {
			catalog,
			stale: false,
			refreshed: false,
		});
		if (result.isErr()) throw result.error;
		expect(result.value.identity).toMatchObject({ provider: "volcengine", family: "deepseek-v4" });
		expect(result.value.rules).toMatchObject({
			maxTokensField: "max_tokens",
			reasoningFormat: "deepseek",
			supportsThinking: true,
			streamHealing: { specialTokens: true, repeatedReasoningDelta: true },
		});
	});

	test("inherits the confirmed DeepSeek 4.1 family through the Volcengine flash alias", () => {
		const catalogSnapshot = {
			catalog: normalizeRuntimeModelCatalog({ providers: { volcengine: { models: {} } } }),
			stale: false,
			refreshed: false,
		};
		const provider = { baseUrl: "https://ark.cn-beijing.volces.com/api/v3" };
		const result = resolveRuntimeModelCompatibilityProfile(
			"custom-profile/deepseek-v4-1-flash-260910",
			provider,
			catalogSnapshot,
		);
		if (result.isErr()) throw result.error;
		expect(result.value.identity.family).toBe("flash");
		expect(result.value.rules).toMatchObject({
			maxTokensField: "max_tokens",
			reasoningFormat: "deepseek",
			supportsThinking: true,
		});
		expect(
			resolveRuntimeModelMetadata("custom-profile/deepseek-v4-1-flash-260910", provider, catalogSnapshot),
		).toMatchObject({
			id: "deepseek-v4-1-flash-260910",
			contextWindow: 1_000_000,
			maxTokens: 384_000,
		});
	});

	test("reads a fresh SQLite fact without requesting the network", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const now = 1_000_000;
			const store = new SqliteRuntimeModelCatalog(database, {
				now: () => now,
				fetcher: async () => {
					throw new Error("network must not be used");
				},
			});
			insertCatalog(database, now, rawCatalog());
			const result = await store.start();
			if (result.isErr()) throw result.error;
			expect(result.value).toMatchObject({ refreshed: false, stale: false });
			expect(result.value.catalog?.providers.openai?.models["gpt-test"]?.name).toBe("GPT Test");
			store.close();
		} finally {
			database.close();
		}
	});

	test("refreshes a stale SQLite fact through the Models.dev SDK", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const now = RUNTIME_MODEL_CATALOG_FRESHNESS_MS + 1;
			let requestUrl: string | undefined;
			const store = new SqliteRuntimeModelCatalog(database, {
				now: () => now,
				fetcher: async (input) => {
					requestUrl = String(input);
					return new Response(JSON.stringify(rawCatalog()));
				},
			});
			insertCatalog(database, 0, rawCatalog(), "old-etag");
			const result = await store.start();
			if (result.isErr()) throw result.error;
			const stored = database
				.prepare("SELECT etag, fetched_at FROM runtime_model_catalog WHERE key = 'default'")
				.get() as unknown as { readonly etag: string | null; readonly fetched_at: number };
			expect(requestUrl).toBe("https://models.dev/catalog.json");
			expect(result.value).toMatchObject({ refreshed: true, stale: false });
			expect(stored).toEqual({ etag: null, fetched_at: now });
			store.close();
		} finally {
			database.close();
		}
	});

	test("returns a stale safe projection when refresh fails after a prior fact", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const now = RUNTIME_MODEL_CATALOG_FRESHNESS_MS + 1;
			const store = new SqliteRuntimeModelCatalog(database, {
				now: () => now,
				fetcher: async () => {
					throw new TypeError("offline");
				},
			});
			insertCatalog(database, 0, rawCatalog());
			const result = await store.refresh();
			if (result.isErr()) throw result.error;
			expect(result.value).toMatchObject({ refreshed: false, stale: true });
			expect(result.value.catalog?.providers.openai?.models["gpt-test"]?.id).toBe("gpt-test");
			store.close();
		} finally {
			database.close();
		}
	});
});

function insertCatalog(database: DatabaseSync, fetchedAt: number, raw: unknown, etag?: string): void {
	database
		.prepare(
			`INSERT INTO runtime_model_catalog (key, catalog_json, etag, fetched_at)
			 VALUES ('default', ?, ?, ?)`,
		)
		.run(JSON.stringify(normalizeRuntimeModelCatalog(raw)), etag ?? null, fetchedAt);
}

function rawCatalog(): unknown {
	return {
		providers: {
			openai: {
				name: "OpenAI",
				models: {
					"gpt-test": {
						name: "GPT Test",
						family: "gpt",
						status: "active",
						release_date: "2025-08-07",
						last_updated: "2026-01-02",
						knowledge: "2024-06",
						open_weights: false,
						attachment: true,
						reasoning: true,
						reasoning_options: ["low", "high", "low"],
						temperature: false,
						interleaved: { field: "reasoning_content" },
						tool_call: true,
						structured_output: true,
						modalities: { input: ["text", "image", "unsupported"], output: ["text"] },
						cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2, reasoning: 3 },
						limit: { context: 200_000, input: 150_000, output: 16_000 },
						credentials: "must not persist",
					},
				},
			},
		},
	};
}
