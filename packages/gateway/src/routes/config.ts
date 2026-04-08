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
			providers: all.providers ?? {},
			maxIterations: all.maxIterations,
			language: all.language,
		});
	});

	return app;
}
