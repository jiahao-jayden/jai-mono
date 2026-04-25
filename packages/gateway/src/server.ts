import { SessionManager } from "@jayden/jai-coding-agent";
import { loadPluginRoutes } from "@jayden/jai-coding-agent/plugin";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { configRoutes } from "./routes/config.js";
import { healthRoutes } from "./routes/health.js";
import { pluginApiRoutes } from "./routes/plugin-api.js";
import { pluginRoutes } from "./routes/plugins.js";
import { sessionRoutes } from "./routes/session.js";
import { workspaceRoutes } from "./routes/workspace.js";

export type GatewayOptions = {
	jaiHome?: string;
	port?: number;
	hostname?: string;
};

export class GatewayServer {
	private app: Hono;
	private manager: SessionManager;
	private server: ReturnType<typeof Bun.serve> | null = null;

	private constructor(app: Hono, manager: SessionManager) {
		this.app = app;
		this.manager = manager;
	}

	static async create(options: GatewayOptions): Promise<GatewayServer> {
		const manager = await SessionManager.create({ jaiHome: options.jaiHome });

		// Run every plugin's `boot` named export once at process startup so
		// plugins can contribute HTTP routes via `registerApiRoute`. Failures
		// are isolated per-plugin; a bad plugin only loses its own routes.
		// envSettings comes from `manager.getPluginEnvSettings()` so the
		// host-injected `JAI_HOME` (and any future host keys) reach plugin
		// `boot()` via `jai.env`.
		const bootResult = await loadPluginRoutes({
			jaiHome: manager.getJaiHome(),
			pluginSettings: (manager.getSettings().get("plugins") ?? {}) as Record<string, unknown>,
			envSettings: manager.getPluginEnvSettings(),
		});
		for (const err of bootResult.errors) {
			console.warn(`[plugin-boot] failed to boot plugin "${err.pluginName}" in ${err.dir}: ${err.message}`);
		}

		const app = new Hono();
		app.use("*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] }));

		app.route("/", healthRoutes());
		app.route("/", configRoutes(manager));
		app.route("/", sessionRoutes(manager));
		app.route("/", workspaceRoutes(manager));
		app.route("/", pluginRoutes(manager));
		app.route("/", pluginApiRoutes(bootResult.routes));

		return new GatewayServer(app, manager);
	}

	listen(port?: number): { port: number; hostname: string } {
		const listenPort = port ?? 18900;
		const hostname = "127.0.0.1";

		this.server = Bun.serve({
			port: listenPort,
			hostname,
			idleTimeout: 255,
			fetch: this.app.fetch as (req: Request, server: any) => Response | Promise<Response>,
		});

		return { port: this.server.port ?? listenPort, hostname };
	}

	async close(): Promise<void> {
		await this.manager.closeAll();
		this.server?.stop();
	}

	getApp(): Hono {
		return this.app;
	}
}
