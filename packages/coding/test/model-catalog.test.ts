import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	MODEL_CATALOG_FRESHNESS_MS,
	findCatalogModelMatch,
	ModelCatalogStore,
	normalizeModelCatalog,
} from "../src/runtime";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Models.dev catalog", () => {
	test("白名单归一化公开元数据，丢弃未识别字段", () => {
		const catalog = normalizeModelCatalog(rawCatalog());
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
	});

	test("缺失能力、限制和价格时保留 unknown，不伪造默认值", () => {
		const catalog = normalizeModelCatalog({
			providers: { test: { models: { unknown: { name: "Unknown" } } } },
		});

		expect(catalog.providers.test?.models.unknown).toEqual({ id: "unknown", name: "Unknown" });
	});

	test("优先采用显式 provider，其次采用模型系列的官方厂商，最后回退唯一 ID", () => {
		const catalog = normalizeModelCatalog({
			providers: {
				openai: { models: { "gpt-5": { name: "GPT 5" }, shared: { name: "OpenAI Shared" } } },
				anthropic: {
					models: { "claude-5": { name: "Claude 5" }, shared: { name: "Anthropic Shared" } },
				},
				gateway: {
					models: {
						"gpt-5": { name: "GPT 5 via gateway" },
						"claude-5": { name: "Claude 5 via gateway" },
					},
				},
			},
		});

		expect(findCatalogModelMatch(catalog, "openai", "gpt-5")).toMatchObject({
			providerId: "openai",
			model: { name: "GPT 5" },
		});
		expect(findCatalogModelMatch(catalog, undefined, "claude-5")).toMatchObject({
			providerId: "anthropic",
			model: { name: "Claude 5" },
		});
		expect(findCatalogModelMatch(catalog, undefined, "gpt-5")).toMatchObject({
			providerId: "openai",
			model: { name: "GPT 5" },
		});
		expect(findCatalogModelMatch(catalog, undefined, "shared")).toBeUndefined();
	});

	test("缓存新鲜时不请求网络", async () => {
		const fixture = await createFixture();
		const now = 1_000_000;
		await writeCache(fixture.cachePath, now, rawCatalog());
		let calls = 0;
		const store = new ModelCatalogStore({
			cachePath: fixture.cachePath,
			now: () => now,
			fetch: async () => {
				calls += 1;
				return new Response();
			},
		});

		const result = await store.start();
		store.close();

		expect(calls).toBe(0);
		expect(result.refreshed).toBe(false);
		expect(result.stale).toBe(false);
		expect(result.catalog?.providers.openai?.models["gpt-test"]?.name).toBe("GPT Test");
	});

	test("hydrate 只读取本地缓存，不请求网络", async () => {
		const fixture = await createFixture();
		await writeCache(fixture.cachePath, 1_000_000, rawCatalog());
		let calls = 0;
		const store = new ModelCatalogStore({
			cachePath: fixture.cachePath,
			fetch: async () => {
				calls += 1;
				return new Response();
			},
		});

		await store.hydrate();
		store.close();

		expect(calls).toBe(0);
		expect(store.cached?.catalog.providers.openai?.models["gpt-test"]?.name).toBe("GPT Test");
	});

	test("过期缓存携带 ETag 刷新并以 0600 原子写回", async () => {
		const fixture = await createFixture();
		const now = MODEL_CATALOG_FRESHNESS_MS + 1;
		await writeCache(fixture.cachePath, 0, rawCatalog(), "old-etag");
		let requestHeaders: Headers | undefined;
		const store = new ModelCatalogStore({
			cachePath: fixture.cachePath,
			now: () => now,
			fetch: async (_url, init) => {
				requestHeaders = new Headers(init?.headers);
				return new Response(JSON.stringify(rawCatalog()), { headers: { etag: "new-etag" } });
			},
		});

		const result = await store.start();
		store.close();
		const cached = JSON.parse(await readFile(fixture.cachePath, "utf8"));
		const file = await stat(fixture.cachePath);

		expect(requestHeaders?.get("if-none-match")).toBe("old-etag");
		expect(result.refreshed).toBe(true);
		expect(cached.etag).toBe("new-etag");
		expect(cached.fetchedAt).toBe(now);
		expect(file.mode & 0o777).toBe(0o600);
	});

	test("刷新失败时继续返回过期缓存", async () => {
		const fixture = await createFixture();
		const now = MODEL_CATALOG_FRESHNESS_MS + 1;
		await writeCache(fixture.cachePath, 0, rawCatalog());
		const store = new ModelCatalogStore({
			cachePath: fixture.cachePath,
			now: () => now,
			fetch: async () => {
				throw new TypeError("offline");
			},
		});

		const result = await store.start();
		store.close();

		expect(result).toMatchObject({ refreshed: false, stale: true });
		expect(result.catalog?.providers.openai?.models["gpt-test"]?.id).toBe("gpt-test");
	});
});

async function createFixture(): Promise<{ cachePath: string }> {
	const root = await mkdtemp(join(tmpdir(), "jai-model-catalog-"));
	roots.push(root);
	return { cachePath: join(root, "cache", "models.dev.json") };
}

async function writeCache(path: string, fetchedAt: number, catalog: unknown, etag?: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		JSON.stringify({
			catalog: normalizeModelCatalog(catalog),
			fetchedAt,
			...(etag ? { etag } : {}),
		}),
	);
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
