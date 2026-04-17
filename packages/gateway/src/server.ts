import { SessionManager } from "@jayden/jai-coding-agent";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { configRoutes } from "./routes/config.js";
import { healthRoutes } from "./routes/health.js";
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

		const app = new Hono();
		app.use("*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] }));

		app.route("/", healthRoutes());
		app.route("/", configRoutes(manager));
		app.route("/", sessionRoutes(manager));
		app.route("/", workspaceRoutes(manager));

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
