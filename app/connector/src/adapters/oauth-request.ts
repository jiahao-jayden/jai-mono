import { Result, type Result as ResultType } from "better-result";
import { ConnectorUpstreamFailed, ConnectorUpstreamRateLimited, ConnectorUpstreamUnavailable } from "../errors";
import type { ActionExecutionContext, ConnectorFailure, JsonValue } from "../types";

export type OAuthServiceFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function oauthAccessToken(
	connectorId: string,
	actionId: string,
	context: ActionExecutionContext,
): ResultType<string, ConnectorUpstreamUnavailable> {
	const accessToken = context.credentials.accessToken;
	return accessToken
		? Result.ok(accessToken)
		: Result.err(
				new ConnectorUpstreamUnavailable({
					message: `${connectorId} OAuth access token is not configured`,
					data: { connectorId, actionId },
				}),
			);
}

export async function oauthJsonRequest(
	connectorId: string,
	actionId: string,
	url: string,
	accessToken: string,
	fetcher: OAuthServiceFetcher,
	init: Omit<RequestInit, "headers" | "signal"> & { readonly headers?: RequestInit["headers"] },
	context: ActionExecutionContext,
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	try {
		const response = await fetcher(url, {
			...init,
			headers: {
				accept: "application/json",
				authorization: `Bearer ${accessToken}`,
				...init.headers,
			},
			signal: context.signal,
		});
		const payload = await readJson(response);
		if (response.status === 429) {
			return Result.err(
				new ConnectorUpstreamRateLimited({
					message: `${connectorId} rate limit exceeded`,
					data: {
						connectorId,
						actionId,
						...(retryAfterMs(response) === undefined ? {} : { retryAfterMs: retryAfterMs(response) }),
					},
				}),
			);
		}
		if (response.status >= 500) {
			return Result.err(
				new ConnectorUpstreamUnavailable({
					message: `${connectorId} is temporarily unavailable`,
					data: { connectorId, actionId, status: response.status },
				}),
			);
		}
		if (!response.ok) {
			return Result.err(
				new ConnectorUpstreamFailed({
					message: `${connectorId} rejected the request`,
					data: { connectorId, actionId, status: response.status },
				}),
			);
		}
		if (response.status === 204) return Result.ok({});
		if (!isJsonValue(payload)) {
			return Result.err(
				new ConnectorUpstreamFailed({
					message: `${connectorId} returned an invalid JSON response`,
					data: { connectorId, actionId, status: response.status },
				}),
			);
		}
		return Result.ok(payload);
	} catch (cause) {
		return Result.err(
			new ConnectorUpstreamUnavailable({
				message: `${connectorId} request failed`,
				data: { connectorId, actionId },
				cause,
			}),
		);
	}
}

export function stringInput(input: Readonly<Record<string, JsonValue>>, key: string): string {
	const value = input[key];
	return typeof value === "string" ? value : "";
}

export function integerInput(input: Readonly<Record<string, JsonValue>>, key: string): number | undefined {
	const value = input[key];
	return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function stringArrayInput(input: Readonly<Record<string, JsonValue>>, key: string): readonly string[] {
	const value = input[key];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

function retryAfterMs(response: Response): number | undefined {
	const seconds = Number(response.headers.get("retry-after"));
	return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : undefined;
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
		return true;
	}
	if (Array.isArray(value)) return value.every(isJsonValue);
	return typeof value === "object" && value !== null && Object.values(value).every(isJsonValue);
}
