import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrajectoryBrowserAssets, createTrajectoryFeed, openTrajectoryHttpServer, type TrajectoryBrowserAssets, type TrajectoryHttpServer } from "../../src/trajectory";
import { InMemoryProductSessionPersistence } from "../../src/sessions";

const servers: TrajectoryHttpServer[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) server.close();
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function openServer(now?: () => Date, browserAssets?: TrajectoryBrowserAssets) {
	const persistence = new InMemoryProductSessionPersistence();
	const created = await persistence.create({
		id: "session-1",
		appState: {},
		runtimeConfiguration: { model: "profile/model", mode: "manual" },
		cwd: "/workspace",
		createdAt: "2026-08-29T00:00:00.000Z",
	});
	if (created.isErr()) throw created.error;
	const admitted = await persistence.admitPrompt({
		sessionId: "session-1",
		inputEntry: {
			type: "message",
			id: "input-1",
			parentId: null,
			timestamp: "2026-08-29T00:00:01.000Z",
			message: { role: "user", content: "private prompt", timestamp: 0 },
		},
		operation: {
			type: "operation_accepted",
			operationId: "operation-1",
			kind: "prompt",
			inputEntryId: "input-1",
			startLeafId: null,
			timestamp: "2026-08-29T00:00:01.000Z",
		},
	});
	if (admitted.isErr()) throw admitted.error;
	const opened = await openTrajectoryHttpServer({
		feed: createTrajectoryFeed({ persistence }),
		...(now ? { now } : {}),
		...(browserAssets ? { browserAssets } : {}),
	});
	if (opened.isErr()) throw opened.error;
	servers.push(opened.value);
	return { persistence, server: opened.value };
}

function request(server: Awaited<ReturnType<typeof openServer>>["server"], token?: string, extra: Readonly<Record<string, string>> = {}) {
	return fetch(`${server.origin}/v1/sessions/session-1/trajectory`, {
		headers: { origin: server.origin, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
	});
}

describe("Trajectory loopback HTTP", () => {
	test("uses an origin-bound Bearer capability and defaults to metadata only", async () => {
		const { server } = await openServer();
		expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const noToken = await request(server);
		expect(noToken.status).toBe(401);
		const capability = server.issue({ sessionId: "session-1" });
		const snapshot = await request(server, capability.token);
		expect(snapshot.status).toBe(200);
		expect(await snapshot.text()).not.toContain("private prompt");
		const badOrigin = await fetch(`${server.origin}/v1/sessions/session-1/trajectory`, {
			headers: { origin: "null", authorization: `Bearer ${capability.token}` },
		});
		expect(badOrigin.status).toBe(403);
		expect(badOrigin.headers.get("access-control-allow-origin")).not.toBe("*");
		const sameOriginBrowser = await fetch(`${server.origin}/v1/sessions/session-1/trajectory`, {
			headers: { "sec-fetch-site": "same-origin", authorization: `Bearer ${capability.token}` },
		});
		expect(sameOriginBrowser.status).toBe(200);
		const queryToken = await fetch(`${server.origin}/v1/sessions/session-1/trajectory?token=${capability.token}`, {
			headers: { origin: server.origin },
		});
		expect(queryToken.status).toBe(401);
	});

	test("expires grants and never accepts a grant from a prior listener", async () => {
		let current = new Date("2026-08-29T00:00:00.000Z");
		const first = await openServer(() => current);
		const grant = first.server.issue({ sessionId: "session-1" });
		current = new Date("2026-08-29T00:05:00.001Z");
		expect((await request(first.server, grant.token)).status).toBe(401);
		const second = await openServer();
		const nextGrant = second.server.issue({ sessionId: "session-1" });
		expect(nextGrant.token).not.toBe(grant.token);
		expect((await request(second.server, grant.token)).status).toBe(401);
	});

	test("exchanges a one-time Browser launch nonce for a memory-only Bearer capability", async () => {
		const { server } = await openServer();
		const launch = server.issueBrowserLaunch({ sessionId: "session-1", scopes: ["prompt"] });
		expect(launch).not.toHaveProperty("token");
		const exchanged = await fetch(`${server.origin}/v1/browser-launch`, {
			method: "POST",
			headers: { "sec-fetch-site": "same-origin", "x-jai-trajectory-launch": launch.launchId },
		});
		expect(exchanged.status).toBe(200);
		const capability = await exchanged.json() as { readonly token: string };
		expect(await (await request(server, capability.token)).text()).toContain("private prompt");
		const reused = await fetch(`${server.origin}/v1/browser-launch`, {
			method: "POST",
			headers: { "sec-fetch-site": "same-origin", "x-jai-trajectory-launch": launch.launchId },
		});
		expect(reused.status).toBe(401);
	});

	test("does not allow a request to expand its fixed scope", async () => {
		const { server } = await openServer();
		const metadata = server.issue({ sessionId: "session-1" });
		const widened = await request(server, metadata.token, { "x-jai-trajectory-scopes": "prompt" });
		expect(widened.status).toBe(403);
		const content = server.issue({ sessionId: "session-1", scopes: ["prompt"] });
		const narrowed = await request(server, content.token, { "x-jai-trajectory-scopes": "prompt" });
		expect(narrowed.status).toBe(200);
		expect(await narrowed.text()).toContain("private prompt");
	});

	test("serves the authenticated OpenAPI description and strict preflight", async () => {
		const { server } = await openServer();
		const capability = server.issue({ sessionId: "session-1" });
		const documentation = await fetch(`${server.origin}/v1/openapi.json`, {
			headers: { origin: server.origin, authorization: `Bearer ${capability.token}` },
		});
		expect(documentation.status).toBe(200);
		const document = await documentation.json() as {
			readonly openapi: string;
			readonly paths: Readonly<Record<string, unknown>>;
			readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
		};
		expect(document.openapi).toBe("3.1.1");
		expect(Object.keys(document.paths)).toEqual([
			"/v1/openapi.json",
			"/v1/sessions/{sessionId}/trajectory",
			"/v1/sessions/{sessionId}/trajectory/events",
		]);
		expect(document.components.schemas.Error).toBeDefined();
		const preflight = await fetch(`${server.origin}/v1/sessions/session-1/trajectory`, {
			method: "OPTIONS",
			headers: { origin: server.origin },
		});
		expect(preflight.headers.get("access-control-allow-origin")).toBe(server.origin);
	});

	test("serves packaged Browser assets without turning them into a capability or trajectory endpoint", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jai-trajectory-browser-"));
		temporaryDirectories.push(directory);
		await writeFile(join(directory, "index.html"), "<!doctype html><title>Trajectory</title>");
		const { server } = await openServer(undefined, createTrajectoryBrowserAssets(directory));
		const page = await fetch(`${server.origin}/trajectory/`);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("Trajectory");
		expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
		expect(page.headers.get("referrer-policy")).toBe("no-referrer");
		expect((await request(server)).status).toBe(401);
	});

	test("bounds a slow SSE reader and closes active SSE streams on Host shutdown", async () => {
		const { persistence, server } = await openServer();
		const capability = server.issue({ sessionId: "session-1" });
		const initial = await request(server, capability.token);
		const initialCursor = (await initial.json() as { readonly cursor: { readonly value: string } }).cursor.value;
		const crowded = await fetch(`${server.origin}/v1/sessions/session-1/trajectory/events?cursor=${initialCursor}`, {
			headers: { origin: server.origin, authorization: `Bearer ${capability.token}` },
		});
		for (let index = 0; index < 80; index += 1) {
			const appended = await persistence.appendOperation({
				sessionId: "session-1",
				record: {
					type: "turn_started",
					operationId: "operation-1",
					turnId: `turn-${index}`,
					timestamp: "2026-08-29T00:00:02.000Z",
				},
			});
			if (appended.isErr()) throw appended.error;
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
		const crowdedEvents = await crowded.text();
		expect(crowdedEvents.match(/event: trajectory/g)?.length).toBeLessThanOrEqual(64);

		const snapshot = await request(server, capability.token);
		const cursor = (await snapshot.json() as { readonly cursor: { readonly value: string } }).cursor.value;
		const events = await fetch(`${server.origin}/v1/sessions/session-1/trajectory/events?cursor=${cursor}`, {
			headers: { origin: server.origin, authorization: `Bearer ${capability.token}` },
		});
		const reader = events.body?.getReader();
		if (!reader) throw new Error("Expected SSE response body");
		const reading = reader.read();
		server.close();
		expect((await reading).done).toBe(false);
		const terminated = await reader.read().then((next) => next.done).catch(() => true);
		expect(terminated).toBe(true);
	});

	test("resumes SSE from the snapshot cursor without losing a fact appended before subscription", async () => {
		const { persistence, server } = await openServer();
		const capability = server.issue({ sessionId: "session-1" });
		const snapshot = await request(server, capability.token);
		const cursor = (await snapshot.json() as { readonly cursor: { readonly value: string } }).cursor.value;
		const appended = await persistence.appendOperation({
			sessionId: "session-1",
			record: { type: "turn_started", operationId: "operation-1", turnId: "turn-1", timestamp: "2026-08-29T00:00:02.000Z" },
		});
		if (appended.isErr()) throw appended.error;
		const events = await fetch(`${server.origin}/v1/sessions/session-1/trajectory/events?cursor=${cursor}`, {
			headers: { origin: server.origin, authorization: `Bearer ${capability.token}` },
		});
		expect(events.status).toBe(200);
		const reader = events.body?.getReader();
		if (!reader) throw new Error("Expected SSE response body");
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain("turn_started");
		await reader.cancel();
	});

	test("keeps an idle SSE connection open for heartbeat delivery", async () => {
		const { server } = await openServer();
		const capability = server.issue({ sessionId: "session-1" });
		const snapshot = await request(server, capability.token);
		const cursor = (await snapshot.json() as { readonly cursor: { readonly value: string } }).cursor.value;
		const events = await fetch(`${server.origin}/v1/sessions/session-1/trajectory/events?cursor=${cursor}`, {
			headers: { origin: server.origin, authorization: `Bearer ${capability.token}` },
		});
		const reader = events.body?.getReader();
		if (!reader) throw new Error("Expected SSE response body");
		expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
		await new Promise((resolve) => setTimeout(resolve, 15_250));
		const heartbeat = await reader.read();
		expect(heartbeat.done).toBe(false);
		expect(new TextDecoder().decode(heartbeat.value)).toContain(": heartbeat");
		await reader.cancel();
	}, 20_000);

	test("maps an unavailable cursor to a snapshot-required HTTP error", async () => {
		const { server } = await openServer();
		const capability = server.issue({ sessionId: "session-1" });
		const response = await fetch(`${server.origin}/v1/sessions/session-1/trajectory/events?cursor=999`, {
			headers: { origin: server.origin, authorization: `Bearer ${capability.token}` },
		});
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: { code: "cursor_expired", message: "Trajectory cursor is not available; request a new snapshot" } });
	});
});
