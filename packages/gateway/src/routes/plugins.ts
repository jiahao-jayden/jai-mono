import type { SessionManager } from "@jayden/jai-coding-agent";
import { Hono } from "hono";

export function pluginRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.get("/sessions/:id/plugins", (c) => {
		const sessionId = c.req.param("id");
		const session = manager.get(sessionId);
		if (!session) return c.json({ error: "Session not found" }, 404);
		return c.json({ plugins: session.listPluginMetas() });
	});

	app.get("/sessions/:id/commands", (c) => {
		const sessionId = c.req.param("id");
		const session = manager.get(sessionId);
		if (!session) return c.json({ error: "Session not found" }, 404);
		return c.json({
			commands: session.listPluginCommands().map((cmd) => ({
				fullName: cmd.fullName,
				description: cmd.description,
				argumentHint: cmd.argumentHint,
				source: `plugin:${cmd.pluginName}`,
			})),
		});
	});

	return app;
}
