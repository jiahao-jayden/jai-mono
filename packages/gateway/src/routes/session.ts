import type { AgentEvent } from "@jayden/jai-agent";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { EventAdapter } from "../events/adapter.js";
import type { SessionManager } from "../session-manager.js";

export function sessionRoutes(manager: SessionManager): Hono {
	const app = new Hono();

	app.post("/sessions", async (c) => {
		try {
			const body = (await c.req.json<{ workspaceId?: string }>().catch(() => null)) ?? {};
			const info = await manager.createSession({ workspaceId: body.workspaceId });
			return c.json(info, 201);
		} catch (err) {
			return c.json({ error: String(err) }, 500);
		}
	});

	app.get("/sessions", (c) => {
		const workspaceId = c.req.query("workspaceId") || undefined;
		return c.json(manager.list({ workspaceId }));
	});

	app.get("/sessions/:id", (c) => {
		const info = manager.getSessionInfo(c.req.param("id"));
		if (!info) return c.json({ error: "Session not found" }, 404);
		return c.json(info);
	});

	app.delete("/sessions/:id", async (c) => {
		const closed = await manager.close(c.req.param("id"));
		if (!closed) return c.json({ error: "Session not found" }, 404);
		return c.body(null, 204);
	});

	app.on(["POST", "PATCH"], "/sessions/:id", async (c) => {
		const body = await c.req.json<{ title?: string }>().catch(() => null);
		if (!body) return c.json({ error: "Invalid body" }, 400);
		const sessionId = c.req.param("id");
		const info = manager.getSessionInfo(sessionId);
		if (!info) return c.json({ error: "Session not found" }, 404);
		if (body.title !== undefined) {
			manager.updateSessionIndex(sessionId, "title", body.title);
		}
		return c.json({ ...info, title: body.title ?? info.title });
	});

	app.get("/sessions/:id/messages", async (c) => {
		const messages = await manager.readMessages(c.req.param("id"));
		if (!messages) return c.json({ error: "Session not found" }, 404);
		return c.json({ messages });
	});

	app.post("/sessions/:id/abort", async (c) => {
		const session = await manager.getOrRestore(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		session.abort();
		return c.json({ status: "aborted" });
	});

	app.post("/sessions/:id/message", async (c) => {
		const session = await manager.getOrRestore(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		if (session.getState() === "running") {
			return c.json({ error: "Session is already running" }, 409);
		}

		const body = await c.req
			.json<{
				text: string;
				attachments?: { filename: string; data: string; mimeType: string; size: number }[];
				modelId?: string;
				reasoningEffort?: string;
			}>()
			.catch(() => null);
		if (!body?.text) {
			return c.json({ error: "Request body must include 'text'" }, 400);
		}

		const settings = manager.getSettings();
		const override = body.modelId
			? settings.withOverrides({ model: body.modelId })
			: null;
		const resolved = override ?? settings;
		const chatOptions = {
			...(override && { model: resolved.resolveModel(), baseURL: resolved.get("baseURL") }),
			reasoningEffort: body.reasoningEffort ?? resolved.get("reasoningEffort"),
			attachments: body.attachments,
		};

		const threadId = session.getSessionId();
		const adapter = new EventAdapter(threadId);

		return streamSSE(c, async (stream) => {
			const heartbeatInterval = setInterval(() => {
				stream.writeSSE({ data: "", event: "heartbeat", id: "" }).catch(() => {});
			}, 15_000);

			let errorEmitted = false;
			const pendingWrites: Array<Promise<void>> = [];
			const unsubscribe = session.onEvent((event: AgentEvent) => {
				const aguiEvents = adapter.translate(event);
				for (const e of aguiEvents) {
					if (e.type === "RUN_ERROR") errorEmitted = true;
					pendingWrites.push(stream.writeSSE({ data: JSON.stringify(e) }));
				}
			});

			try {
				await session.chat(body.text, chatOptions);
				await Promise.all(pendingWrites);
			} catch (err) {
				await Promise.all(pendingWrites);
				if (!errorEmitted) {
					const errorEvent = {
						type: "RUN_ERROR" as const,
						message: err instanceof Error ? err.message : String(err),
					};
					await stream.writeSSE({ data: JSON.stringify(errorEvent) });
				}
			} finally {
				clearInterval(heartbeatInterval);
				unsubscribe();

				const sessionId = c.req.param("id");
				const info = manager.getSessionInfo(sessionId);
				if (info && !info.firstMessage) {
					manager.updateSessionIndex(sessionId, "firstMessage", body.text.slice(0, 200));
				}
				if (info && !info.title) {
					const s = manager.getSettings();
					let title: string | null = null;
					try {
						title = await session.generateSessionTitle({
							model: s.resolveModel(),
							baseURL: s.get("baseURL"),
						});
					} catch {}
					if (title) {
						manager.updateSessionIndex(sessionId, "title", title);
						await stream
							.writeSSE({ data: JSON.stringify({ type: "TITLE_GENERATED", title }) })
							.catch(() => {});
					}
				}
			}
		});
	});

	return app;
}
