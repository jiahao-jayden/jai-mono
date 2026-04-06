import type { ProviderSettings } from "@jayden/jai-coding-agent";
import { Hono } from "hono";
import type { SessionManager } from "../session-manager.js";

export function configRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.get("/config", (c) => {
		const settings = manager.getSettings();
		const all = settings.getAll();
		return c.json({
			model: all.model,
			provider: all.provider,
			maxIterations: all.maxIterations,
			language: all.language,
		});
	});

	app.get("/models", (c) => {
		const settings = manager.getSettings();
		const all = settings.getAll();
		const models: Array<{ id: string; provider: string }> = [];

		if (all.providers) {
			for (const [providerId, providerConfig] of Object.entries(all.providers as Record<string, ProviderSettings>)) {
				if (!providerConfig.enabled) continue;
				for (const model of providerConfig.models) {
					const modelId = typeof model === "string" ? model : (model as { id: string }).id;
					models.push({ id: `${providerId}/${modelId}`, provider: providerId });
				}
			}
		}

		if (models.length === 0) {
			models.push({ id: all.model, provider: all.provider });
		}

		return c.json({ models });
	});

	return app;
}
