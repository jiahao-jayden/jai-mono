import type { ApiRouteRegistry, PluginRouteMethod } from "@jayden/jai-coding-agent/plugin";
import { Hono } from "hono";

const PREFIX = "/api/plugins";

/**
 * Mount plugin-contributed HTTP routes under `/api/plugins/<plugin>/...`.
 *
 * - Path lookup is `(plugin name, method, plugin-relative path)` against the
 *   process-level `ApiRouteRegistry` populated at gateway boot.
 * - Returns 404 when the plugin namespace or path is unknown, and 405 when
 *   the path exists but the method is not registered. This mirrors standard
 *   HTTP semantics.
 * - Plugin handlers receive the raw `Request`. Errors thrown by handlers are
 *   converted to 500 responses; the gateway itself does not crash.
 */
export function pluginApiRoutes(routes: ApiRouteRegistry): Hono {
	const app = new Hono();

	app.all(`${PREFIX}/:plugin/*`, async (c) => {
		const pluginName = c.req.param("plugin");
		const method = c.req.method.toUpperCase();
		if (method !== "GET" && method !== "POST") {
			return c.json({ error: "Method not allowed" }, 405);
		}

		const url = new URL(c.req.url);
		const subpath = stripPrefix(url.pathname, `${PREFIX}/${pluginName}`);
		if (subpath === null) return c.json({ error: "Bad request" }, 400);
		const handlerPath = subpath.length === 0 ? "/" : subpath;

		const route = routes.find(pluginName, method as PluginRouteMethod, handlerPath);
		if (!route) {
			if (routes.hasPath(pluginName, handlerPath)) {
				return c.json({ error: `Method ${method} not allowed on ${handlerPath}` }, 405);
			}
			return c.json({ error: `No plugin route for ${pluginName} ${method} ${handlerPath}` }, 404);
		}

		try {
			return await route.handler(c.req.raw);
		} catch (err) {
			console.error(`[plugin-api:${pluginName}] handler threw on ${method} ${handlerPath}`, err);
			return c.json(
				{
					error: "Plugin route handler failed",
					message: err instanceof Error ? err.message : String(err),
				},
				500,
			);
		}
	});

	return app;
}

function stripPrefix(pathname: string, prefix: string): string | null {
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	if (rest.length === 0) return "";
	if (!rest.startsWith("/")) return null;
	return rest;
}
