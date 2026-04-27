import type { PluginScanEntry, SessionManager } from "@jayden/jai-coding-agent";
import { Hono } from "hono";

export type PluginListItem = PluginScanEntry & {
	config: unknown;
};

export type PluginListResponse = {
	plugins: PluginListItem[];
};

export type CommandListItem = {
	fullName: string;
	description?: string;
	argumentHint?: string;
	source: string;
};

export type CommandListResponse = {
	commands: CommandListItem[];
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

	app.get("/sessions/:id/plugins", async (c) => {
		const sessionId = c.req.param("id");
		const session = await manager.getOrRestore(sessionId);
		if (!session) return c.json({ error: "Session not found" }, 404);
		return c.json({ plugins: session.listPluginMetas() });
	});

	app.get("/sessions/:id/commands", async (c) => {
		const sessionId = c.req.param("id");
		const session = await manager.getOrRestore(sessionId);
		if (!session) return c.json({ error: "Session not found" }, 404);
		const commands: CommandListItem[] = session.listPluginCommands().map((cmd) => ({
			fullName: cmd.fullName,
			description: cmd.description,
			argumentHint: cmd.argumentHint,
			source: `plugin:${cmd.pluginName}`,
		}));
		return c.json({ commands } satisfies CommandListResponse);
	});

	app.get("/commands", async (c) => {
		const workspaceId = c.req.query("workspaceId") ?? undefined;
		const list = await manager.listAvailableCommands({ workspaceId });
		const commands: CommandListItem[] = list.map((cmd) => ({
			fullName: cmd.fullName,
			description: cmd.description,
			argumentHint: cmd.argumentHint,
			source: `plugin:${cmd.pluginName}`,
		}));
		return c.json({ commands } satisfies CommandListResponse);
	});

	return app;
}
