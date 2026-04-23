import { join } from "node:path";
import { type EnrichedModelInfo, enrichModelInfo } from "@jayden/jai-ai";
import type { SessionManager } from "@jayden/jai-coding-agent";
import { parseModelId } from "@jayden/jai-utils";
import { Hono } from "hono";
import type { FetchModelsResponse } from "../types/api.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CONTEXT_WINDOW = 128_000;

// 优先级：自定义 provider 显式 limit > 注册表（enrichModelInfo）> 128K 兜底。
// 注册表 key 是裸 modelId，先 parseModelId 去 "provider/" 前缀再查。
function resolveContextWindow(manager: SessionManager): number {
	const all = manager.getSettings().getAll();
	const parsed = parseModelId(all.model);
	const bareModelId = parsed?.model ?? all.model;
	const providerId = parsed?.provider;

	const customModels = providerId ? all.providers?.[providerId]?.models : undefined;
	const customEntry = customModels?.find((m) => (typeof m === "string" ? m : m.id) === bareModelId);
	if (customEntry && typeof customEntry !== "string" && customEntry.limit) {
		return customEntry.limit.context;
	}

	return enrichModelInfo(bareModelId).limit?.context ?? DEFAULT_CONTEXT_WINDOW;
}

function toConfigResponse(manager: SessionManager) {
	const all = manager.getSettings().getAll();
	return {
		model: all.model,
		provider: all.provider,
		providers: all.providers ?? {},
		maxIterations: all.maxIterations,
		language: all.language,
		reasoningEffort: all.reasoningEffort,
		contextWindow: resolveContextWindow(manager),
		env: all.env ?? {},
		plugins: all.plugins ?? {},
	};
}

type ModelsCache = Record<string, { fetchedAt: number; models: EnrichedModelInfo[] }>;

async function readModelsCache(cachePath: string): Promise<ModelsCache> {
	const file = Bun.file(cachePath);
	if (!(await file.exists())) return {};
	try {
		return JSON.parse(await file.text()) as ModelsCache;
	} catch {
		return {};
	}
}

async function writeModelsCache(cachePath: string, cache: ModelsCache): Promise<void> {
	await Bun.write(cachePath, JSON.stringify(cache, null, 2));
}

export function configRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.get("/config", (c) => {
		return c.json(toConfigResponse(manager));
	});

	const updateConfig = async (c: any) => {
		const body = await c.req.json();

		if (body.model && typeof body.model === "string") {
			const slash = body.model.indexOf("/");
			if (slash !== -1) {
				body.provider = body.model.slice(0, slash);
			} else if (body.provider) {
				body.model = `${body.provider}/${body.model}`;
			}
		}

		await manager.getSettings().save(body);
		return c.json(toConfigResponse(manager));
	};

	app.patch("/config", updateConfig);
	app.post("/config", updateConfig);

	app.put("/config/providers/:id", async (c) => {
		const providerId = c.req.param("id");
		const providerConfig = await c.req.json();
		await manager.getSettings().save({ providers: { [providerId]: providerConfig } });
		return c.json(toConfigResponse(manager));
	});

	app.delete("/config/providers/:id", async (c) => {
		const providerId = c.req.param("id");
		await manager.getSettings().deleteProvider(providerId);
		return c.json(toConfigResponse(manager));
	});

	app.get("/config/providers/:id/models", async (c) => {
		const providerId = c.req.param("id");
		const force = c.req.query("force") === "true";
		const cacheOnly = c.req.query("cacheOnly") === "true";

		const allSettings = manager.getSettings().getAll();
		const providerConfig = allSettings.providers?.[providerId];
		if (!providerConfig) {
			return c.json({ error: `Provider "${providerId}" not configured` }, 404);
		}

		const cachePath = join(manager.getJaiHome(), "models-cache.json");
		const cache = await readModelsCache(cachePath);

		if (cache[providerId]) {
			const age = Date.now() - cache[providerId].fetchedAt;
			if (cacheOnly || (!force && age < CACHE_TTL_MS)) {
				return c.json({
					providerId,
					models: cache[providerId].models,
					fetchedAt: cache[providerId].fetchedAt,
					cached: true,
				} satisfies FetchModelsResponse);
			}
		}

		if (cacheOnly) {
			return c.json({
				providerId,
				models: [],
				fetchedAt: 0,
				cached: false,
			} satisfies FetchModelsResponse);
		}

		const baseUrl = (providerConfig.api_base || "").replace(/\/+$/, "");
		if (!baseUrl) {
			return c.json({ error: "Provider has no api_base configured" }, 400);
		}

		try {
			const headers: Record<string, string> = { "Content-Type": "application/json" };
			if (providerConfig.api_key) {
				headers.Authorization = `Bearer ${providerConfig.api_key}`;
			}

			const resp = await fetch(`${baseUrl}/models`, { headers });
			if (!resp.ok) {
				const text = await resp.text().catch(() => "");
				return c.json({ error: `Upstream returned ${resp.status}: ${text.slice(0, 200)}` }, 502);
			}

			const body = (await resp.json()) as { data?: { id: string }[]; object?: string };
			const rawModels: string[] = (body.data ?? []).map((m) => m.id);

			const enriched = rawModels.map(enrichModelInfo);

			const now = Date.now();
			cache[providerId] = { fetchedAt: now, models: enriched };
			await writeModelsCache(cachePath, cache);

			return c.json({
				providerId,
				models: enriched,
				fetchedAt: now,
				cached: false,
			} satisfies FetchModelsResponse);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Failed to fetch models: ${message}` }, 502);
		}
	});

	return app;
}
