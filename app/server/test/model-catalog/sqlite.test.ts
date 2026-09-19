import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import {
	findRuntimeModelCatalogMatch,
	normalizeRuntimeModelCatalog,
	RUNTIME_MODEL_CATALOG_FRESHNESS_MS,
	SqliteRuntimeModelCatalog,
} from "../../src";

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
	});

	test("matches a Volcengine list ID to the dated catalog revision", () => {
		const catalog = normalizeRuntimeModelCatalog({
			providers: {
				deepseek: {
					name: "DeepSeek",
					models: {
						"deepseek-flash": {
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
