import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { createTrajectoryReadAccess } from "./access";
import type { TrajectoryBrowserAssets } from "./browser-assets";
import type { TrajectoryContentScope, TrajectoryFeed, TrajectorySubscription } from "./types";

const CAPABILITY_TTL_MS = 5 * 60_000;
const BROWSER_LAUNCH_TTL_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const SSE_IDLE_TIMEOUT_SECONDS = 30;
const MAX_BUFFERED_SSE_EVENTS = 32;
const scopeHeader = "x-jai-trajectory-scopes";

export interface TrajectoryCapability {
	readonly token: string;
	readonly expiresAt: string;
}

export interface TrajectoryBrowserLaunch {
	readonly launchId: string;
	readonly expiresAt: string;
}

export interface TrajectoryHttpServer {
	readonly origin: string;
	issue(input: {
		readonly sessionId: string;
		readonly scopes?: readonly TrajectoryContentScope[];
	}): TrajectoryCapability;
	issueBrowserLaunch(input: {
		readonly sessionId: string;
		readonly scopes?: readonly TrajectoryContentScope[];
	}): TrajectoryBrowserLaunch;
	close(): void;
}

export class TrajectoryHttpOpenFailed extends TaggedError("trajectory.http_open_failed")<{
	readonly message: string;
	cause?: unknown;
}> {}

interface CapabilityGrant {
	readonly sessionId: string;
	readonly scopes: readonly TrajectoryContentScope[];
	readonly expiresAt: number;
}

interface BrowserLaunchGrant {
	readonly sessionId: string;
	readonly scopes: readonly TrajectoryContentScope[];
	readonly expiresAt: number;
}

export async function openTrajectoryHttpServer(input: {
	readonly feed: TrajectoryFeed;
	readonly browserAssets?: TrajectoryBrowserAssets;
	now?: () => Date;
}): Promise<ResultType<TrajectoryHttpServer, TrajectoryHttpOpenFailed>> {
	let server: Server | undefined;
	try {
		const now = input.now ?? (() => new Date());
		const grants = new Map<string, CapabilityGrant>();
		const browserLaunches = new Map<string, BrowserLaunchGrant>();
		const closeConnections = new Set<() => void>();
		let closed = false;
		let origin = "";
		const listener = createServer((request, response) => {
			void respondToNodeRequest(request, response, {
				feed: input.feed,
				grants,
				browserLaunches,
				now,
				origin,
				closeConnections,
				browserAssets: input.browserAssets,
			});
		});
		server = listener;
		listener.timeout = SSE_IDLE_TIMEOUT_SECONDS * 1_000;
		await listenOnLoopback(listener);
		const address = listener.address();
		if (!address || typeof address === "string")
			throw new Error("Trajectory loopback listener did not provide a TCP address");
		origin = `http://127.0.0.1:${address.port}`;
		return Result.ok({
			origin,
			issue(capability) {
				return issueCapability(grants, now, capability);
			},
			issueBrowserLaunch(launch) {
				const launchId = randomBytes(32).toString("base64url");
				const expiresAt = now().getTime() + BROWSER_LAUNCH_TTL_MS;
				browserLaunches.set(launchId, {
					sessionId: launch.sessionId,
					scopes: [...(launch.scopes ?? [])],
					expiresAt,
				});
				return { launchId, expiresAt: new Date(expiresAt).toISOString() };
			},
			close() {
				if (closed) return;
				closed = true;
				for (const close of closeConnections) close();
				closeConnections.clear();
				grants.clear();
				browserLaunches.clear();
				listener.close();
			},
		});
	} catch (cause) {
		server?.close();
		return Result.err(
			new TrajectoryHttpOpenFailed({ message: "Could not open trajectory loopback listener", cause }),
		);
	}
}

async function listenOnLoopback(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const rejectOpen = (error: Error) => {
			server.off("listening", resolve);
			reject(error);
		};
		server.once("error", rejectOpen);
		server.once("listening", () => {
			server.off("error", rejectOpen);
			resolve();
		});
		server.listen(0, "127.0.0.1");
	});
}

async function respondToNodeRequest(
	request: IncomingMessage,
	response: ServerResponse,
	context: Parameters<typeof handleRequest>[1],
): Promise<void> {
	let result: Response;
	try {
		result = await handleRequest(nodeRequest(request), context);
	} catch {
		result = error("unavailable", "Trajectory is temporarily unavailable", 503, context.origin);
	}
	response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
	if (!result.body) {
		response.end();
		return;
	}
	const reader = result.body.getReader();
	let completed = false;
	try {
		while (!response.destroyed) {
			const next = await reader.read();
			if (next.done) {
				completed = true;
				break;
			}
			if (!response.write(next.value)) {
				await Promise.race([once(response, "drain"), once(response, "close")]);
			}
		}
	} finally {
		if (!completed) await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	response.end();
}

function nodeRequest(request: IncomingMessage): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) headers.append(name, item);
		} else {
			headers.set(name, value);
		}
	}
	return new Request(`http://127.0.0.1${request.url ?? "/"}`, { method: request.method ?? "GET", headers });
}

async function handleRequest(
	request: Request,
	context: {
		readonly feed: TrajectoryFeed;
		readonly grants: Map<string, CapabilityGrant>;
		readonly browserLaunches: Map<string, BrowserLaunchGrant>;
		readonly now: () => Date;
		readonly origin: string;
		readonly closeConnections: Set<() => void>;
		readonly browserAssets?: TrajectoryBrowserAssets;
	},
): Promise<Response> {
	const browserAsset = await context.browserAssets?.respond(request);
	if (browserAsset) return browserAsset;
	if (request.method === "OPTIONS") return preflight(request, context.origin);
	if (urlPath(request) === "/v1/browser-launch" && request.method === "POST") {
		return exchangeBrowserLaunch(request, context);
	}
	const authorization = authorize(request, context);
	if (authorization instanceof Response) return authorization;
	const url = new URL(request.url);
	if (url.pathname === "/v1/openapi.json" && request.method === "GET") return json(openApi(), 200, context.origin);
	const match = /^\/v1\/sessions\/([^/]+)\/trajectory(?:\/events)?$/.exec(url.pathname);
	if (!match || request.method !== "GET") return error("not_found", "Endpoint does not exist", 404, context.origin);
	const sessionId = decodeURIComponent(match[1]!);
	if (authorization.sessionId !== sessionId)
		return error("forbidden", "Capability is not valid for this Session", 403, context.origin);
	const scopes = narrowedScopes(request, authorization.scopes);
	if (!scopes) return error("invalid_scope", "Requested scope exceeds capability", 403, context.origin);
	const access = createTrajectoryReadAccess({ sessionId, scopes });
	if (access.isErr()) return error("invalid_scope", "Requested scope is not allowed", 403, context.origin);
	if (url.pathname.endsWith("/events")) {
		return sse({
			feed: context.feed,
			access: access.value,
			cursor: url.searchParams.get("cursor") ?? "0",
			origin: context.origin,
			expiresAt: authorization.expiresAt,
			closeConnections: context.closeConnections,
		});
	}
	const snapshot = await context.feed.snapshot(access.value);
	if (snapshot.isErr()) return trajectoryError(snapshot.error._tag, snapshot.error.message, context.origin);
	return json(snapshot.value, 200, context.origin);
}

function issueCapability(
	grants: Map<string, CapabilityGrant>,
	now: () => Date,
	capability: { readonly sessionId: string; readonly scopes?: readonly TrajectoryContentScope[] },
): TrajectoryCapability {
	const token = randomBytes(32).toString("base64url");
	const expiresAt = now().getTime() + CAPABILITY_TTL_MS;
	grants.set(token, { sessionId: capability.sessionId, scopes: [...(capability.scopes ?? [])], expiresAt });
	return { token, expiresAt: new Date(expiresAt).toISOString() };
}

function exchangeBrowserLaunch(
	request: Request,
	context: {
		readonly grants: Map<string, CapabilityGrant>;
		readonly browserLaunches: Map<string, BrowserLaunchGrant>;
		readonly now: () => Date;
		readonly origin: string;
	},
): Response {
	if (request.headers.get("origin") !== context.origin && !isSameOriginBrowserRequest(request)) {
		return error("origin_forbidden", "Origin is not allowed", 403, context.origin);
	}
	const launchId = request.headers.get("x-jai-trajectory-launch");
	const launch = launchId ? context.browserLaunches.get(launchId) : undefined;
	if (!launch || launch.expiresAt <= context.now().getTime()) {
		if (launchId) context.browserLaunches.delete(launchId);
		return error("unauthorized", "Browser launch is invalid or expired", 401, context.origin);
	}
	context.browserLaunches.delete(launchId!);
	const capability = issueCapability(context.grants, context.now, launch);
	return json({ token: capability.token }, 200, context.origin);
}

function urlPath(request: Request): string {
	return new URL(request.url).pathname;
}

function authorize(
	request: Request,
	context: { readonly grants: Map<string, CapabilityGrant>; readonly now: () => Date; readonly origin: string },
): CapabilityGrant | Response {
	const origin = request.headers.get("origin");
	if (origin !== context.origin && !isSameOriginBrowserRequest(request)) {
		return error("origin_forbidden", "Origin is not allowed", 403, context.origin);
	}
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Bearer "))
		return error("unauthorized", "Bearer capability is required", 401, context.origin);
	const token = header.slice("Bearer ".length);
	const grant = context.grants.get(token);
	if (!grant || grant.expiresAt <= context.now().getTime()) {
		context.grants.delete(token);
		return error("unauthorized", "Bearer capability is invalid or expired", 401, context.origin);
	}
	return grant;
}

function isSameOriginBrowserRequest(request: Request): boolean {
	return request.headers.get("origin") === null && request.headers.get("sec-fetch-site") === "same-origin";
}

function narrowedScopes(request: Request, grant: readonly TrajectoryContentScope[]): readonly string[] | undefined {
	const raw = request.headers.get(scopeHeader);
	if (!raw?.trim()) return grant;
	const requested = raw
		.split(",")
		.map((scope) => scope.trim())
		.filter(Boolean);
	return requested.every((scope) => grant.includes(scope as TrajectoryContentScope)) ? requested : undefined;
}

function preflight(request: Request, origin: string): Response {
	if (request.headers.get("origin") !== origin) return error("origin_forbidden", "Origin is not allowed", 403, origin);
	return new Response(null, {
		status: 204,
		headers: cors(origin, {
			"access-control-allow-methods": "GET, OPTIONS",
			"access-control-allow-headers": "authorization, x-jai-trajectory-scopes",
		}),
	});
}

async function sse(input: {
	readonly feed: TrajectoryFeed;
	readonly access: Parameters<TrajectoryFeed["snapshot"]>[0];
	readonly cursor: string;
	readonly origin: string;
	readonly expiresAt: number;
	readonly closeConnections: Set<() => void>;
}): Promise<Response> {
	const encoder = new TextEncoder();
	let subscription: TrajectorySubscription | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let expiry: ReturnType<typeof setTimeout> | undefined;
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	let emit: ((item: unknown) => boolean) | undefined;
	let closed = false;
	const pending: unknown[] = [];
	const close = () => {
		if (closed) return;
		closed = true;
		if (heartbeat) clearInterval(heartbeat);
		if (expiry) clearTimeout(expiry);
		subscription?.close();
		input.closeConnections.delete(close);
		try {
			controller?.close();
		} catch {
			// The browser may have already cancelled this disposable stream.
		}
	};
	const opened = await input.feed.subscribe(input.access, { value: input.cursor }, (item) => {
		if (closed) return;
		if (emit) {
			if (!emit(item)) close();
			return;
		}
		if (pending.length >= MAX_BUFFERED_SSE_EVENTS) {
			close();
			return;
		}
		pending.push(item);
	});
	if (opened.isErr()) return trajectoryError(opened.error._tag, opened.error.message, input.origin);
	subscription = opened.value;
	if (closed) {
		subscription.close();
		return error("unavailable", "Trajectory replay exceeded the SSE connection limit", 503, input.origin);
	}
	const stream = new ReadableStream<Uint8Array>(
		{
			start(nextController) {
				controller = nextController;
				emit = (item) => {
					if (nextController.desiredSize !== null && nextController.desiredSize <= 0) return false;
					return enqueueSse(nextController, "trajectory", trajectoryCursor(item), item, encoder);
				};
				if (!enqueueSse(nextController, "ready", input.cursor, { cursor: { value: input.cursor } }, encoder)) {
					close();
					return;
				}
				for (const item of pending.splice(0)) {
					if (!emit(item)) {
						close();
						return;
					}
				}
				input.closeConnections.add(close);
				heartbeat = setInterval(() => {
					if (closed) return;
					try {
						nextController.enqueue(encoder.encode(": heartbeat\n\n"));
					} catch {
						close();
					}
				}, HEARTBEAT_MS);
				expiry = setTimeout(close, Math.max(0, input.expiresAt - Date.now()));
			},
			cancel() {
				close();
			},
		},
		{ highWaterMark: MAX_BUFFERED_SSE_EVENTS, size: () => 1 },
	);
	return new Response(stream, {
		headers: cors(input.origin, { "content-type": "text/event-stream", "cache-control": "no-cache" }),
	});
}

function enqueueSse(
	controller: ReadableStreamDefaultController<Uint8Array>,
	event: string,
	id: string,
	data: unknown,
	encoder: TextEncoder,
): boolean {
	try {
		controller.enqueue(
			encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
		);
		return true;
	} catch {
		return false;
	}
}

function trajectoryCursor(item: unknown): string {
	if (typeof item !== "object" || item === null) return "";
	const cursor = (item as { readonly cursor?: { readonly value?: unknown } }).cursor;
	return typeof cursor?.value === "string" ? cursor.value : "";
}

function trajectoryError(tag: string, message: string, origin: string): Response {
	if (tag === "trajectory.cursor_expired") return error("cursor_expired", message, 409, origin);
	if (tag === "trajectory.access_denied") return error("forbidden", message, 403, origin);
	return error("unavailable", "Trajectory is temporarily unavailable", 503, origin);
}

function error(code: string, message: string, status: number, origin: string): Response {
	return json({ error: safeTrajectoryError(code, message) }, status, origin);
}

function safeTrajectoryError(code: string, message: string): { readonly code: string; readonly message: string } {
	return { code, message };
}

function json(value: unknown, status: number, origin: string): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: cors(origin, { "content-type": "application/json; charset=utf-8" }),
	});
}

function cors(origin: string, headers: Record<string, string>): Headers {
	return new Headers({ ...headers, "access-control-allow-origin": origin, vary: "origin" });
}

function openApi(): Record<string, unknown> {
	return {
		openapi: "3.1.1",
		info: {
			title: "Jai Trajectory Preview",
			version: "v1",
			description: "Local read-only preview. Bearer capabilities are process-local and expire after five minutes.",
		},
		paths: {
			"/v1/openapi.json": {
				get: {
					security: [{ bearerAuth: [] }],
					responses: {
						"200": { description: "This OpenAPI document" },
						"401": { $ref: "#/components/responses/Error" },
						"403": { $ref: "#/components/responses/Error" },
					},
				},
			},
			"/v1/sessions/{sessionId}/trajectory": {
				get: {
					security: [{ bearerAuth: [] }],
					parameters: [sessionParameter(), scopeParameter()],
					responses: {
						"200": {
							description: "Trajectory snapshot",
							content: { "application/json": { schema: { $ref: "#/components/schemas/TrajectorySnapshot" } } },
						},
						"401": { $ref: "#/components/responses/Error" },
						"403": { $ref: "#/components/responses/Error" },
						"404": { $ref: "#/components/responses/Error" },
						"503": { $ref: "#/components/responses/Error" },
					},
				},
			},
			"/v1/sessions/{sessionId}/trajectory/events": {
				get: {
					security: [{ bearerAuth: [] }],
					parameters: [
						sessionParameter(),
						scopeParameter(),
						{ name: "cursor", in: "query", required: false, schema: { type: "string", default: "0" } },
					],
					responses: {
						"200": {
							description:
								"SSE begins with a `ready` event carrying the accepted cursor, then emits `trajectory` items with their cursor as id",
							content: { "text/event-stream": { schema: { type: "string" } } },
						},
						"401": { $ref: "#/components/responses/Error" },
						"403": { $ref: "#/components/responses/Error" },
						"409": { $ref: "#/components/responses/Error" },
						"503": { $ref: "#/components/responses/Error" },
					},
				},
			},
		},
		components: {
			securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Jai scoped capability" } },
			responses: {
				Error: {
					description: "Whitelisted error DTO",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
			schemas: {
				Scope: {
					type: "string",
					enum: ["prompt", "final_text", "reasoning", "tool_input", "tool_output"],
					description: "Request scopes may only narrow the capability grant; the default grant is metadata-only.",
				},
				Cursor: {
					type: "object",
					required: ["value"],
					properties: { value: { type: "string" } },
					additionalProperties: false,
				},
				TrajectorySnapshot: {
					type: "object",
					required: ["session", "cursor", "items"],
					properties: {
						session: { type: "object" },
						cursor: { $ref: "#/components/schemas/Cursor" },
						items: { type: "array", items: { $ref: "#/components/schemas/TrajectoryItem" } },
					},
					additionalProperties: false,
				},
				TrajectoryItem: {
					type: "object",
					required: ["id", "cursor", "timestamp", "type"],
					properties: {
						id: { type: "string" },
						parentId: { type: "string" },
						cursor: { $ref: "#/components/schemas/Cursor" },
						timestamp: { type: "string", format: "date-time" },
						type: { type: "string", enum: ["live_chunk", "message", "journal"] },
						chunk: { type: "object" },
						message: { type: "object" },
						journal: { type: "object" },
					},
				},
				Error: {
					type: "object",
					required: ["error"],
					properties: {
						error: {
							type: "object",
							required: ["code", "message"],
							properties: {
								code: {
									type: "string",
									enum: [
										"unauthorized",
										"forbidden",
										"origin_forbidden",
										"invalid_scope",
										"cursor_expired",
										"not_found",
										"unavailable",
									],
								},
								message: { type: "string" },
							},
							additionalProperties: false,
						},
					},
					additionalProperties: false,
				},
			},
		},
	};
}

function sessionParameter(): Record<string, unknown> {
	return { name: "sessionId", in: "path", required: true, schema: { type: "string" } };
}

function scopeParameter(): Record<string, unknown> {
	return {
		name: scopeHeader,
		in: "header",
		required: false,
		schema: { type: "string" },
		description: "Comma-separated subset of the capability scopes.",
	};
}
