import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	MODEL_CATALOG_FRESHNESS_MS,
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
			reasoning: true,
			toolCall: true,
			structuredOutput: true,
			inputModalities: ["text", "image"],
			outputModalities: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, reasoning: 3 },
			contextWindow: 200_000,
			maxTokens: 16_000,
		});
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
						reasoning: true,
						tool_call: true,
						structured_output: true,
						modalities: { input: ["text", "image", "unsupported"], output: ["text"] },
						cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2, reasoning: 3 },
						limit: { context: 200_000, output: 16_000 },
						credentials: "must not persist",
					},
				},
			},
		},
	};
}
