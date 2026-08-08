import { Result, type Result as ResultType } from "better-result";
import { ConnectorProtocolInvalid, ConnectorRequestCancelled, ConnectorServiceUnavailable } from "./errors";
import { isWireResponse, remoteError } from "./protocol";
import type {
	ActionGuideResponse,
	ConnectorFailure,
	ConnectorService,
	ExecuteActionInput,
	ExecuteActionResponse,
	GetActionGuideInput,
	HealthResponse,
	ListAppsResponse,
	ListConnectionsResponse,
	RequestContext,
	SearchActionsInput,
	SearchActionsResponse,
} from "./types";

export interface ConnectorClientOptions {
	readonly endpoint: string;
	readonly runtimeToken?: string;
	readonly fetcher?: ConnectorFetcher;
}

export type ConnectorFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class HttpConnectorClient implements ConnectorService {
	readonly #endpoint: string;
	readonly #runtimeToken?: string;
	readonly #fetcher: ConnectorFetcher;

	constructor(options: ConnectorClientOptions) {
		this.#endpoint = options.endpoint.replace(/\/$/u, "");
		this.#runtimeToken = options.runtimeToken;
		this.#fetcher = options.fetcher ?? fetch;
	}

	listApps(context: RequestContext): Promise<ResultType<ListAppsResponse, ConnectorFailure>> {
		return this.#request("GET", "/apps", undefined, context);
	}

	listConnections(context: RequestContext): Promise<ResultType<ListConnectionsResponse, ConnectorFailure>> {
		return this.#request("GET", "/connections", undefined, context);
	}

	searchActions(
		input: SearchActionsInput,
		context: RequestContext,
	): Promise<ResultType<SearchActionsResponse, ConnectorFailure>> {
		return this.#request("POST", "/actions/search", input, context);
	}

	getActionGuide(
		input: GetActionGuideInput,
		context: RequestContext,
	): Promise<ResultType<ActionGuideResponse, ConnectorFailure>> {
		return this.#request("POST", "/actions/guide", input, context);
	}

	executeAction(
		input: ExecuteActionInput,
		context: RequestContext,
	): Promise<ResultType<ExecuteActionResponse, ConnectorFailure>> {
		return this.#request("POST", "/actions/execute", input, context);
	}

	health(context: RequestContext): Promise<ResultType<HealthResponse, ConnectorFailure>> {
		return this.#request("GET", "/health", undefined, context);
	}

	async #request<T>(
		method: "GET" | "POST",
		path: string,
		body: unknown,
		context: RequestContext,
	): Promise<ResultType<T, ConnectorFailure>> {
		const headers = new Headers({
			accept: "application/json",
			"x-connector-request-id": context.requestId,
		});
		if (body !== undefined) headers.set("content-type", "application/json");
		if (this.#runtimeToken) headers.set("authorization", `Bearer ${this.#runtimeToken}`);
		const cancel = () => {
			void this.#cancelRequest(context.requestId);
		};
		if (context.signal?.aborted) cancel();
		context.signal?.addEventListener("abort", cancel, { once: true });
		try {
			const response = await this.#fetcher(`${this.#endpoint}${path}`, {
				method,
				headers,
				...(body === undefined
					? {}
					: { body: JSON.stringify({ ...body, ...(context.sessionId ? { sessionId: context.sessionId } : {}) }) }),
				signal: context.signal,
			});
			if (context.signal?.aborted)
				return Result.err(
					new ConnectorRequestCancelled({
						message: "Connector request was cancelled",
						data: { requestId: context.requestId },
					}),
				);
			const payload: unknown = await response.json();
			if (!isWireResponse(payload))
				return Result.err(
					new ConnectorProtocolInvalid({
						message: "Connector response did not match the wire protocol",
						data: { reason: "invalid_response" },
					}),
				);
			if (!payload.ok) return Result.err(remoteError(payload.error));
			return Result.ok(payload.value as T);
		} catch (cause) {
			if (context.signal?.aborted) {
				return Result.err(
					new ConnectorRequestCancelled({
						message: "Connector request was cancelled",
						data: { requestId: context.requestId },
					}),
				);
			}
			if (cause instanceof ConnectorProtocolInvalid) return Result.err(cause);
			return Result.err(
				new ConnectorServiceUnavailable({
					message: "Connector Service request failed",
					data: { endpoint: this.#endpoint },
					cause,
				}),
			);
		} finally {
			context.signal?.removeEventListener("abort", cancel);
		}
	}

	async #cancelRequest(requestId: string): Promise<void> {
		const headers = new Headers({ accept: "application/json", "x-connector-request-id": `${requestId}:cancel` });
		if (this.#runtimeToken) headers.set("authorization", `Bearer ${this.#runtimeToken}`);
		await this.#fetcher(`${this.#endpoint}/requests/${encodeURIComponent(requestId)}/cancel`, {
			method: "POST",
			headers,
			body: "{}",
		}).catch(() => {});
	}

	async close(): Promise<void> {}
}
