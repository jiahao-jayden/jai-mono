import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { EventAdapter } from "../src/events/adapter.js";
import { AGUIEventType } from "../src/events/types.js";
import { configRoutes } from "../src/routes/config.js";
import { healthRoutes } from "../src/routes/health.js";
import { sessionRoutes } from "../src/routes/session.js";

// ── Mock SessionManager ──────────────────────────────────────
// We mock SessionManager to avoid Workspace/SettingsManager dependency in tests

class MockAgentSession {
	private _sessionId: string;
	private _state: "idle" | "running" | "aborted" = "idle";
	private _messages: any[] = [];
	private _listeners: Array<(event: any) => void> = [];

	constructor(sessionId: string) {
		this._sessionId = sessionId;
	}

	getSessionId() {
		return this._sessionId;
	}
	getState() {
		return this._state;
	}
	getMessages() {
		return this._messages;
	}

	async chat(text: string) {
		this._state = "running";
		this._messages.push({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});

		this.emit({ type: "agent_start" });
		this.emit({ type: "stream", event: { type: "message_start" } });
		this.emit({ type: "stream", event: { type: "text_delta", text: `Echo: ${text}` } });
		this.emit({
			type: "stream",
			event: {
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: `Echo: ${text}` }],
					stopReason: "stop",
					usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
					timestamp: Date.now(),
				},
			},
		});
		this.emit({ type: "agent_end", messages: [] });

		this._state = "idle";
		this._messages.push({
			role: "assistant",
			content: [{ type: "text", text: `Echo: ${text}` }],
			stopReason: "stop",
			usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
			timestamp: Date.now(),
		});

		return [];
	}

	abort() {
		this._state = "aborted";
	}

	async close() {
		this.abort();
	}

	onEvent(listener: (event: any) => void): () => void {
		this._listeners.push(listener);
		return () => {
			this._listeners = this._listeners.filter((l) => l !== listener);
		};
	}

	private emit(event: any) {
		for (const l of this._listeners) l(event);
	}
}

class MockSessionManager {
	private sessions = new Map<string, { session: MockAgentSession; createdAt: number }>();
	private _settings = {
		getAll: () => ({
			model: "test/mock-model",
			provider: "test",
			maxIterations: 10,
			language: "en",
			providers: {
				test: {
					enabled: true,
					api_base: "http://localhost",
					api_format: "openai-compatible",
					models: [{ id: "mock-model" }],
				},
			},
		}),
	};

	async createSession() {
		const id = `session-${this.sessions.size + 1}`;
		const session = new MockAgentSession(id);
		this.sessions.set(id, { session, createdAt: Date.now() });
		return { sessionId: id, state: "idle" as const, createdAt: Date.now() };
	}

	get(id: string) {
		return this.sessions.get(id)?.session;
	}

	list() {
		return Array.from(this.sessions.entries()).map(([id, { session, createdAt }]) => ({
			sessionId: id,
			state: session.getState(),
			createdAt,
		}));
	}

	async close(id: string) {
		const entry = this.sessions.get(id);
		if (!entry) return false;
		await entry.session.close();
		this.sessions.delete(id);
		return true;
	}

	async closeAll() {
		for (const { session } of this.sessions.values()) await session.close();
		this.sessions.clear();
	}

	getSettings() {
		return this._settings;
	}
}

// ── Test App Setup ───────────────────────────────────────────

function createTestApp() {
	const manager = new MockSessionManager();
	const app = new Hono();
	app.route("/", healthRoutes());
	app.route("/", configRoutes(manager as any));
	app.route("/", sessionRoutes(manager as any));
	return { app, manager };
}

// ── Health Route Tests ───────────────────────────────────────

describe("Health Route", () => {
	test("GET /health returns ok", async () => {
		const { app } = createTestApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(body.timestamp).toBeGreaterThan(0);
	});
});

// ── Config Route Tests ───────────────────────────────────────

describe("Config Routes", () => {
	test("GET /config returns settings", async () => {
		const { app } = createTestApp();
		const res = await app.request("/config");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.model).toBe("test/mock-model");
		expect(body.maxIterations).toBe(10);
	});

	test("GET /models returns model list", async () => {
		const { app } = createTestApp();
		const res = await app.request("/models");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.models.length).toBeGreaterThan(0);
		expect(body.models[0].provider).toBe("test");
	});
});

// ── Session CRUD Tests ───────────────────────────────────────

describe("Session CRUD", () => {
	test("POST /sessions creates a session", async () => {
		const { app } = createTestApp();
		const res = await app.request("/sessions", { method: "POST" });
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.sessionId).toBeTruthy();
		expect(body.state).toBe("idle");
	});

	test("GET /sessions lists sessions", async () => {
		const { app } = createTestApp();
		await app.request("/sessions", { method: "POST" });
		await app.request("/sessions", { method: "POST" });

		const res = await app.request("/sessions");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.length).toBe(2);
	});

	test("GET /sessions/:id returns session details", async () => {
		const { app } = createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.sessionId).toBe(sessionId);
	});

	test("GET /sessions/:id returns 404 for unknown session", async () => {
		const { app } = createTestApp();
		const res = await app.request("/sessions/nonexistent");
		expect(res.status).toBe(404);
	});

	test("DELETE /sessions/:id closes a session", async () => {
		const { app } = createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}`, { method: "DELETE" });
		expect(res.status).toBe(204);

		const getRes = await app.request(`/sessions/${sessionId}`);
		expect(getRes.status).toBe(404);
	});

	test("DELETE /sessions/:id returns 404 for unknown", async () => {
		const { app } = createTestApp();
		const res = await app.request("/sessions/nonexistent", { method: "DELETE" });
		expect(res.status).toBe(404);
	});
});

// ── Messages Tests ───────────────────────────────────────────

describe("Session Messages", () => {
	test("GET /sessions/:id/messages returns empty initially", async () => {
		const { app } = createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/messages`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.messages).toEqual([]);
	});

	test("GET /sessions/:id/messages returns 404 for unknown", async () => {
		const { app } = createTestApp();
		const res = await app.request("/sessions/nonexistent/messages");
		expect(res.status).toBe(404);
	});
});

// ── Abort Tests ──────────────────────────────────────────────

describe("Session Abort", () => {
	test("POST /sessions/:id/abort aborts session", async () => {
		const { app } = createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/abort`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("aborted");
	});

	test("POST /sessions/:id/abort returns 404 for unknown", async () => {
		const { app } = createTestApp();
		const res = await app.request("/sessions/nonexistent/abort", { method: "POST" });
		expect(res.status).toBe(404);
	});
});

// ── POST /message SSE Tests ──────────────────────────────────

describe("POST /sessions/:id/message SSE", () => {
	test("returns 404 for unknown session", async () => {
		const { app } = createTestApp();
		const res = await app.request("/sessions/nonexistent/message", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
		});
		expect(res.status).toBe(404);
	});

	test("returns 400 for missing text", async () => {
		const { app } = createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("returns SSE stream with AG-UI events", async () => {
		const { app } = createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");

		const text = await res.text();
		const dataLines = text
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.filter((s) => s.length > 0);

		const events = dataLines.map((line) => JSON.parse(line));

		const types = events.map((e: any) => e.type);
		expect(types).toContain(AGUIEventType.RUN_STARTED);
		expect(types).toContain(AGUIEventType.TEXT_MESSAGE_START);
		expect(types).toContain(AGUIEventType.TEXT_MESSAGE_CONTENT);
		expect(types).toContain(AGUIEventType.TEXT_MESSAGE_END);
		expect(types).toContain(AGUIEventType.RUN_FINISHED);

		const contentEvent = events.find((e: any) => e.type === AGUIEventType.TEXT_MESSAGE_CONTENT);
		expect(contentEvent.delta).toBe("Echo: hello");
	});

	test("messages are accessible after chat", async () => {
		const { app } = createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		await app.request(`/sessions/${sessionId}/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "test" }),
		});

		const msgRes = await app.request(`/sessions/${sessionId}/messages`);
		const body = await msgRes.json();
		expect(body.messages.length).toBe(2);
		expect(body.messages[0].role).toBe("user");
		expect(body.messages[1].role).toBe("assistant");
	});
});
