import { Hono } from "hono";

export function healthRoutes(): Hono {
	const app = new Hono();

	app.get("/health", (c) => {
		return c.json({
			status: "ok",
			timestamp: Date.now(),
		});
	});

	return app;
}
