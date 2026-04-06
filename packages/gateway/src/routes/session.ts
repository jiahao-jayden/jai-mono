import type { AgentEvent } from "@jayden/jai-agent";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { EventAdapter } from "../events/adapter.js";
import type { SessionManager } from "../session-manager.js";

export function sessionRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.post("/sessions", async (c) => {
		try {
			const info = await manager.createSession();
			return c.json(info, 201);
		} catch (err) {
			return c.json({ error: String(err) }, 500);
		}
	});

	app.get("/sessions", (c) => {
		return c.json(manager.list());
	});

	app.get("/sessions/:id", (c) => {
		const session = manager.get(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		return c.json({
			sessionId: session.getSessionId(),
			state: session.getState(),
		});
	});

	app.delete("/sessions/:id", async (c) => {
		const closed = await manager.close(c.req.param("id"));
		if (!closed) return c.json({ error: "Session not found" }, 404);
		return c.body(null, 204);
	});

	app.get("/sessions/:id/messages", (c) => {
		const session = manager.get(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		const messages = session.getMessages();
		return c.json({ messages });
	});

	app.post("/sessions/:id/abort", (c) => {
		const session = manager.get(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		session.abort();
		return c.json({ status: "aborted" });
	});

	app.post("/sessions/:id/message", async (c) => {
		const session = manager.get(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		if (session.getState() === "running") {
			return c.json({ error: "Session is already running" }, 409);
		}

		const body = await c.req.json<{ text: string }>().catch(() => null);
		if (!body?.text) {
			return c.json({ error: "Request body must include 'text'" }, 400);
		}

		const threadId = session.getSessionId();
		const adapter = new EventAdapter(threadId);

		return streamSSE(c, async (stream) => {
			const heartbeatInterval = setInterval(() => {
				stream.writeSSE({ data: "", event: "heartbeat", id: "" }).catch(() => {});
			}, 15_000);

			const pendingWrites: Array<Promise<void>> = [];
			const unsubscribe = session.onEvent((event: AgentEvent) => {
				const aguiEvents = adapter.translate(event);
				for (const e of aguiEvents) {
					pendingWrites.push(stream.writeSSE({ data: JSON.stringify(e) }));
				}
			});

			try {
				await session.chat(body.text);
				await Promise.all(pendingWrites);
			} catch (err) {
				const errorEvent = {
					type: "RUN_ERROR" as const,
					message: err instanceof Error ? err.message : String(err),
				};
				await stream.writeSSE({ data: JSON.stringify(errorEvent) });
			} finally {
				clearInterval(heartbeatInterval);
				unsubscribe();
			}
		});
	});

	return app;
}
