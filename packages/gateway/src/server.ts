import { Hono } from "hono";
import { cors } from "hono/cors";
import { configRoutes } from "./routes/config.js";
import { healthRoutes } from "./routes/health.js";
import { sessionRoutes } from "./routes/session.js";
import { SessionManager } from "./session-manager.js";

export type GatewayOptions = {
	cwd: string;
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
		const manager = await SessionManager.create({ cwd: options.cwd });

		const app = new Hono();
		app.use("*", cors());

		app.route("/", healthRoutes());
		app.route("/", configRoutes(manager));
		app.route("/", sessionRoutes(manager));

		return new GatewayServer(app, manager);
	}

	listen(port?: number): { port: number; hostname: string } {
		const listenPort = port ?? 18900;
		const hostname = "127.0.0.1";

		this.server = Bun.serve({
			port: listenPort,
			hostname,
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
