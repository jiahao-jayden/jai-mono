import type { PluginScanEntry, SessionManager } from "@jayden/jai-coding-agent";
import { Hono } from "hono";

export type PluginListItem = PluginScanEntry & {
	/** Raw config from settings.json → plugins[<name>], may be undefined. */
	config: unknown;
};

export type PluginListResponse = {
	plugins: PluginListItem[];
};

export function pluginRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.get("/plugins", async (c) => {
		const result = await manager.scanPlugins();
		const rawPlugins = (manager.getSettings().get("plugins") ?? {}) as Record<string, unknown>;

		const plugins: PluginListItem[] = result.entries.map((entry) => ({
			...entry,
			config: rawPlugins[entry.name],
		}));

		plugins.sort((a, b) => a.name.localeCompare(b.name));

		return c.json({ plugins } satisfies PluginListResponse);
	});

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
