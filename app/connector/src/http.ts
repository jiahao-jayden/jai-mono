import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Result as ResultType } from "better-result";
import { ConnectorInputInvalid, ConnectorUnauthorized } from "./errors";
import { failureResponse, successResponse, type WireResponse } from "./protocol";
import type {
	ConnectorService,
	ExecuteActionInput,
	GetActionGuideInput,
	RequestContext,
	SearchActionsInput,
} from "./types";

export interface ConnectorHttpServerOptions {
	readonly host?: string;
	readonly port?: number;
	readonly runtimeToken?: string;
	readonly maxBodyBytes?: number;
}

export interface ConnectorHttpServer {
	readonly url: string;
	readonly port: number;
	close(): Promise<void>;
}

export async function startConnectorHttpServer(
	service: ConnectorService,
	options: ConnectorHttpServerOptions = {},
): Promise<ConnectorHttpServer> {
	const host = options.host ?? "127.0.0.1";
	const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
	const controllers = new Map<string, AbortController>();
	const server = createServer((request, response) => {
		void handleRequest(service, request, response, options.runtimeToken, maxBodyBytes, controllers);
	});
	await listen(server, host, options.port ?? 0);
	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server);
		throw new Error("Connector HTTP server did not expose a TCP address");
	}
	return {
		url: `http://${host}:${address.port}/v1`,
		port: address.port,
		close: () => closeServer(server),
	};
}

async function handleRequest(
	service: ConnectorService,
	request: IncomingMessage,
	response: ServerResponse,
	runtimeToken: string | undefined,
	maxBodyBytes: number,
	controllers: Map<string, AbortController>,
): Promise<void> {
	const requestId = headerValue(request, "x-connector-request-id") ?? randomUUID();
	const method = request.method ?? "GET";
	const url = new URL(request.url ?? "/", "http://connector.local");
	if (runtimeToken !== undefined && headerValue(request, "authorization") !== `Bearer ${runtimeToken}`) {
		writeJson(
			response,
			401,
			failureResponse(
				requestId,
				new ConnectorUnauthorized({ message: "Connector runtime token is invalid", data: { requestId } }),
			),
		);
		return;
	}
	if (url.pathname === "/v1/health" && method === "GET") {
		await writeServiceResult(response, requestId, service.health({ requestId }));
		return;
	}
	if (url.pathname === "/v1/apps" && method === "GET") {
		await writeServiceResult(response, requestId, service.listApps({ requestId }));
		return;
	}
	if (url.pathname === "/v1/connections" && method === "GET") {
		await writeServiceResult(response, requestId, service.listConnections({ requestId }));
		return;
	}
	const cancelMatch = url.pathname.match(/^\/v1\/requests\/([^/]+)\/cancel$/);
	if (cancelMatch && method === "POST") {
		const controller = controllers.get(decodeURIComponent(cancelMatch[1]!));
		controller?.abort();
		writeJson(response, 200, successResponse(requestId, { cancelled: controller !== undefined }));
		return;
	}
	if (method !== "POST") {
		writeJson(
			response,
			404,
			failureResponse(
				requestId,
				new ConnectorInputInvalid({
					message: "Connector route was not found",
					data: { actionId: url.pathname, reason: "route_not_found" },
				}),
			),
		);
		return;
	}
	const controller = new AbortController();
	controllers.set(requestId, controller);
	try {
		const body = await readJson(request, maxBodyBytes);
		const context: RequestContext = {
			requestId,
			...(body.sessionId === undefined ? {} : { sessionId: requiredString(body, "sessionId") }),
			signal: controller.signal,
		};
		if (url.pathname === "/v1/actions/search") {
			await writeServiceResult(response, requestId, service.searchActions(parseSearchInput(body), context));
			return;
		}
		if (url.pathname === "/v1/actions/guide") {
			await writeServiceResult(response, requestId, service.getActionGuide(parseGuideInput(body), context));
			return;
		}
		if (url.pathname === "/v1/actions/execute") {
			await writeServiceResult(response, requestId, service.executeAction(parseExecuteInput(body), context));
			return;
		}
		writeJson(
			response,
			404,
			failureResponse(
				requestId,
				new ConnectorInputInvalid({
					message: "Connector route was not found",
					data: { actionId: url.pathname, reason: "route_not_found" },
				}),
			),
		);
	} catch (error) {
		writeJson(response, 400, failureResponse(requestId, error));
	} finally {
		controllers.delete(requestId);
	}
}

async function writeServiceResult<T>(
	response: ServerResponse,
	requestId: string,
	result: Promise<ResultType<T, unknown>>,
): Promise<void> {
	const resolved = await result;
	if (resolved.isOk()) {
		writeJson(response, 200, successResponse(requestId, resolved.value));
		return;
	}
	writeJson(response, 200, failureResponse(requestId, resolved.error));
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.byteLength;
		if (total > maxBodyBytes)
			throw new ConnectorInputInvalid({
				message: "Connector request body is too large",
				data: { actionId: "<request>", reason: "body_too_large" },
			});
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	let value: unknown;
	try {
		value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw invalidRequest("invalid_json");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new ConnectorInputInvalid({
			message: "Connector request body must be an object",
			data: { actionId: "<request>", reason: "body_not_object" },
		});
	return value as Record<string, unknown>;
}

function parseSearchInput(body: Record<string, unknown>): SearchActionsInput {
	assertKeys(body, ["sessionId", "query", "providerId", "connectionAlias", "sideEffect", "limit", "cursor"]);
	const sideEffect = optionalString(body, "sideEffect");
	if (sideEffect !== undefined && sideEffect !== "read" && sideEffect !== "write" && sideEffect !== "destructive")
		throw invalidRequest("side_effect_invalid");
	const limit = body.limit;
	if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100))
		throw invalidRequest("limit_invalid");
	return {
		...(body.query === undefined ? {} : { query: requiredString(body, "query") }),
		...(body.providerId === undefined ? {} : { providerId: requiredString(body, "providerId") }),
		...(body.connectionAlias === undefined ? {} : { connectionAlias: requiredString(body, "connectionAlias") }),
		...(sideEffect === undefined ? {} : { sideEffect }),
		...(limit === undefined ? {} : { limit }),
		...(body.cursor === undefined ? {} : { cursor: requiredString(body, "cursor") }),
	};
}

function parseGuideInput(body: Record<string, unknown>): GetActionGuideInput {
	assertKeys(body, ["sessionId", "actionId", "connectionAlias"]);
	return {
		actionId: requiredString(body, "actionId"),
		...(body.connectionAlias === undefined ? {} : { connectionAlias: requiredString(body, "connectionAlias") }),
	};
}

function parseExecuteInput(body: Record<string, unknown>): ExecuteActionInput {
	assertKeys(body, ["sessionId", "actionId", "connectionAlias", "input", "approvalId"]);
	const input = body.input;
	if (!isJsonObject(input)) throw invalidRequest("input_invalid");
	return {
		actionId: requiredString(body, "actionId"),
		...(body.connectionAlias === undefined ? {} : { connectionAlias: requiredString(body, "connectionAlias") }),
		input,
		...(body.approvalId === undefined ? {} : { approvalId: requiredString(body, "approvalId") }),
	};
}

function assertKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
	const allowedKeys = new Set(allowed);
	const unexpected = Object.keys(body).find((key) => !allowedKeys.has(key));
	if (unexpected) throw invalidRequest(`unknown_field:${unexpected}`);
}

function requiredString(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (typeof value !== "string" || value.length === 0) throw invalidRequest(`${key}_invalid`);
	return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
	if (body[key] === undefined) return undefined;
	return requiredString(body, key);
}

function invalidRequest(reason: string): ConnectorInputInvalid {
	return new ConnectorInputInvalid({
		message: "Connector request DTO is invalid",
		data: { actionId: "<request>", reason },
	});
}

function isJsonObject(value: unknown): value is Record<string, import("./types").JsonValue> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is import("./types").JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "string") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return typeof value === "object" && value !== null && Object.values(value).every(isJsonValue);
}

function writeJson(response: ServerResponse, status: number, body: WireResponse<unknown>): void {
	if (response.headersSent) return;
	response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
	const value = request.headers[name];
	return Array.isArray(value) ? value[0] : value;
}

function listen(server: Server, host: string, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
