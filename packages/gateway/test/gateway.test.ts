import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, mock, test } from "bun:test";

// Intercept LLM streaming before any code path imports it.
// runAgentLoop only requires `message_end` (carries assistant message).
mock.module("@jayden/jai-ai", () => {
	const real = require("@jayden/jai-ai");
	return {
		...real,
		streamMessage: async function* () {
			yield { type: "message_start" };
			yield { type: "text_delta", text: "Echo response" };
			yield {
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Echo response" }],
					stopReason: "stop",
					usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
					timestamp: Date.now(),
				},
			};
			yield {
				type: "step_finish",
				finishReason: "stop",
				usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
			};
		},
	};
});

import { SessionManager } from "@jayden/jai-coding-agent";
import { Hono } from "hono";
import { AGUIEventType } from "../src/events/types.js";
import { configRoutes } from "../src/routes/config.js";
import { healthRoutes } from "../src/routes/health.js";
import { pluginRoutes } from "../src/routes/plugins.js";
import { sessionRoutes } from "../src/routes/session.js";
import { workspaceRoutes } from "../src/routes/workspace.js";

// ── Test App Setup ───────────────────────────────────────────

const cleanups: Array<() => Promise<void>> = [];

async function createTestApp() {
	const tmpJaiHome = join(tmpdir(), `jai-gw-test-${crypto.randomUUID()}`);
	await mkdir(tmpJaiHome, { recursive: true });
	await copyFile(
		join(import.meta.dir, "fixtures", "settings.minimal.json"),
		join(tmpJaiHome, "settings.json"),
	);
	const manager = await SessionManager.create({ jaiHome: tmpJaiHome });

	const app = new Hono();
	app.route("/", healthRoutes());
	app.route("/", configRoutes(manager));
	app.route("/", sessionRoutes(manager));
	app.route("/", workspaceRoutes(manager));
	app.route("/", pluginRoutes(manager));

	cleanups.push(async () => {
		await manager.closeAll();
		await rm(tmpJaiHome, { recursive: true, force: true });
	});
	return { app, manager, tmpJaiHome };
}

afterEach(async () => {
	const tasks = cleanups.splice(0);
	for (const fn of tasks) {
		await fn().catch(() => {});
	}
});

// ── Health Route Tests ───────────────────────────────────────

describe("Health Route", () => {
	test("GET /health returns ok", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(body.timestamp).toBeGreaterThan(0);
	});
});

// ── Config Route Tests ───────────────────────────────────────

describe("Config Routes", () => {
	test("GET /config returns settings + computed contextWindow", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/config");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.model).toBe("test/mock-model");
		expect(body.maxIterations).toBe(3);
		expect(body.providers.test.enabled).toBe(true);
		expect(body.contextWindow).toBe(128000);
	});

	test("PATCH /config updates fields and returns merged settings", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/config", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ maxIterations: 7, language: "zh" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.maxIterations).toBe(7);
		expect(body.language).toBe("zh");
		expect(body.model).toBe("test/mock-model");
	});

	test("POST /config behaves the same as PATCH", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ maxIterations: 9 }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).maxIterations).toBe(9);
	});

	test("PUT /config/providers/:id adds a provider", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/config/providers/extra", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				api_base: "http://extra.local",
				api_format: "openai-compatible",
				api_key: "sk-extra",
				models: [{ id: "extra-model" }],
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.providers.extra).toBeDefined();
		expect(body.providers.extra.api_base).toBe("http://extra.local");
		expect(body.providers.test).toBeDefined();
	});

	test("DELETE /config/providers/:id removes a provider", async () => {
		const { app } = await createTestApp();
		await app.request("/config/providers/extra", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled: true,
				api_base: "http://extra.local",
				api_format: "openai-compatible",
				models: [{ id: "extra-model" }],
			}),
		});

		const res = await app.request("/config/providers/extra", { method: "DELETE" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.providers.extra).toBeUndefined();
	});

	test("GET /config/providers/:id/models with cacheOnly returns empty when no cache", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/config/providers/test/models?cacheOnly=true");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.providerId).toBe("test");
		expect(body.models).toEqual([]);
		expect(body.cached).toBe(false);
	});

	test("GET /config/providers/:id/models 404 for unknown provider", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/config/providers/nope/models?cacheOnly=true");
		expect(res.status).toBe(404);
	});
});

// ── Session CRUD Tests ───────────────────────────────────────

describe("Session CRUD", () => {
	test("POST /sessions creates a session with full SessionInfo", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions", { method: "POST" });
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.sessionId).toBeTruthy();
		expect(body.workspaceId).toBe("default");
		expect(body.filePath).toBeTruthy();
		expect(body.model).toBe("mock-model");
		expect(body.messageCount).toBe(0);
		expect(body.createdAt).toBeGreaterThan(0);
	});

	test("POST /sessions accepts custom workspaceId", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: "myws" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.workspaceId).toBe("myws");
	});

	test("GET /sessions lists sessions", async () => {
		const { app } = await createTestApp();
		await app.request("/sessions", { method: "POST" });
		await app.request("/sessions", { method: "POST" });

		const res = await app.request("/sessions");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.length).toBe(2);
		expect(body[0].sessionId).toBeTruthy();
	});

	test("GET /sessions filtered by workspaceId", async () => {
		const { app } = await createTestApp();
		await app.request("/sessions", { method: "POST" });
		await app.request("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: "alt" }),
		});

		const res = await app.request("/sessions?workspaceId=alt");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.length).toBe(1);
		expect(body[0].workspaceId).toBe("alt");
	});

	test("GET /sessions/:id returns session details", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.sessionId).toBe(sessionId);
		expect(body.workspaceId).toBe("default");
	});

	test("GET /sessions/:id returns 404 for unknown session", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions/nonexistent");
		expect(res.status).toBe(404);
	});

	test("PATCH /sessions/:id updates title", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "renamed" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.title).toBe("renamed");

		const fresh = await (await app.request(`/sessions/${sessionId}`)).json();
		expect(fresh.title).toBe("renamed");
	});

	test("DELETE /sessions/:id closes a session", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}`, { method: "DELETE" });
		expect(res.status).toBe(204);

		const getRes = await app.request(`/sessions/${sessionId}`);
		expect(getRes.status).toBe(404);
	});

	test("DELETE /sessions/:id returns 404 for unknown", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions/nonexistent", { method: "DELETE" });
		expect(res.status).toBe(404);
	});
});

// ── Messages Tests ───────────────────────────────────────────

describe("Session Messages", () => {
	test("GET /sessions/:id/messages returns empty initially", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/messages`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.messages).toEqual([]);
		expect(body.compactions).toEqual([]);
	});

	test("GET /sessions/:id/messages returns 404 for unknown", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions/nonexistent/messages");
		expect(res.status).toBe(404);
	});
});

// ── Abort Tests ──────────────────────────────────────────────

describe("Session Abort", () => {
	test("POST /sessions/:id/abort aborts session", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/abort`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("aborted");
	});

	test("POST /sessions/:id/abort returns 404 for unknown", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions/nonexistent/abort", { method: "POST" });
		expect(res.status).toBe(404);
	});
});

// ── POST /message SSE Tests ──────────────────────────────────

describe("POST /sessions/:id/message SSE", () => {
	test("returns 404 for unknown session", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions/nonexistent/message", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
		});
		expect(res.status).toBe(404);
	});

	test("returns 400 for missing text and attachments", async () => {
		const { app } = await createTestApp();
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
		const { app } = await createTestApp();
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
		expect(contentEvent.delta).toBe("Echo response");
	});

	test("messages are accessible after chat", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const sseRes = await app.request(`/sessions/${sessionId}/message`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "test" }),
		});
		await sseRes.text();

		// AgentSession.persistMessage on `message_end` is fire-and-forget;
		// poll briefly for the assistant message to land in the JSONL store.
		let body: any;
		for (let i = 0; i < 20; i++) {
			const msgRes = await app.request(`/sessions/${sessionId}/messages`);
			body = await msgRes.json();
			if (body.messages.length >= 2) break;
			await Bun.sleep(25);
		}
		expect(body.messages.length).toBe(2);
		expect(body.messages[0].role).toBe("user");
		expect(body.messages[1].role).toBe("assistant");
	});
});

// ── Permission Reply Route Tests ────────────────────────────

describe("POST /sessions/:id/permission/:reqId/reply", () => {
	test("returns 404 for unknown session", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions/nope/permission/perm_x/reply", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "allow_once" }),
		});
		expect(res.status).toBe(404);
	});

	test("returns 400 for invalid kind", async () => {
		const { app } = await createTestApp();
		const create = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await create.json();

		const res = await app.request(`/sessions/${sessionId}/permission/perm_x/reply`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "yolo" }),
		});
		expect(res.status).toBe(400);
	});

	test("returns 404 when reqId not pending", async () => {
		const { app } = await createTestApp();
		const create = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await create.json();

		const res = await app.request(`/sessions/${sessionId}/permission/perm_missing/reply`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "allow_once" }),
		});
		expect(res.status).toBe(404);
	});

	test("resolves a pending request with the chosen decision", async () => {
		const { app, manager } = await createTestApp();
		const create = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await create.json();

		const session = await manager.getOrRestore(sessionId);
		expect(session).toBeTruthy();
		const service = session?.getPermissionService();
		expect(service).toBeTruthy();

		const { id, promise } = service?.request({
			toolCallId: "tc_1",
			toolName: "FileWrite",
			request: {
				category: "external_write",
				reason: "test",
				muteKey: "k1",
			},
		}) as { id: string; promise: Promise<{ kind: string }> };

		const res = await app.request(`/sessions/${sessionId}/permission/${id}/reply`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "allow_session" }),
		});
		expect(res.status).toBe(200);

		const decision = await promise;
		expect(decision.kind).toBe("allow_session");
	});
});

// ── Workspace Routes ─────────────────────────────────────────

describe("Workspace Routes", () => {
	test("GET /workspace/:id/files lists files in default workspace", async () => {
		const { app, manager } = await createTestApp();
		await app.request("/sessions", { method: "POST" });

		const wsPath = manager.getWorkspacePath("default");
		await Bun.write(join(wsPath, "hello.txt"), "world");
		await mkdir(join(wsPath, "sub"), { recursive: true });
		await Bun.write(join(wsPath, "sub", "nested.md"), "# nested");

		const res = await app.request("/workspace/default/files");
		expect(res.status).toBe(200);
		const body = await res.json();
		const names = body.entries.map((e: any) => e.name);
		expect(names).toContain("hello.txt");
		expect(names).toContain("sub");
	});

	test("GET /workspace/:id/file returns text content", async () => {
		const { app, manager } = await createTestApp();
		await app.request("/sessions", { method: "POST" });

		const wsPath = manager.getWorkspacePath("default");
		await Bun.write(join(wsPath, "note.md"), "# hi");

		const res = await app.request("/workspace/default/file?path=note.md");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.content).toBe("# hi");
		expect(body.mimeType).toBe("text/markdown");
	});

	test("GET /workspace/:id/file 404 for missing file", async () => {
		const { app } = await createTestApp();
		await app.request("/sessions", { method: "POST" });

		const res = await app.request("/workspace/default/file?path=missing.md");
		expect(res.status).toBe(404);
	});

	test("GET /workspace/:id/file 400 for missing path query", async () => {
		const { app } = await createTestApp();
		await app.request("/sessions", { method: "POST" });

		const res = await app.request("/workspace/default/file");
		expect(res.status).toBe(400);
	});
});

// ── Plugin Routes ────────────────────────────────────────────

describe("Plugin Routes", () => {
	test("GET /sessions/:id/plugins returns empty plugin list", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/plugins`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.plugins)).toBe(true);
	});

	test("GET /sessions/:id/plugins 404 for unknown", async () => {
		const { app } = await createTestApp();
		const res = await app.request("/sessions/nonexistent/plugins");
		expect(res.status).toBe(404);
	});

	test("GET /sessions/:id/commands returns command list", async () => {
		const { app } = await createTestApp();
		const createRes = await app.request("/sessions", { method: "POST" });
		const { sessionId } = await createRes.json();

		const res = await app.request(`/sessions/${sessionId}/commands`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.commands)).toBe(true);
	});
});
