import { Result, type Result as ResultType } from "better-result";
import { ConnectorProviderFailed, ConnectorProviderRateLimited, ConnectorProviderUnavailable } from "../errors";
import type { ActionExecutionContext, ConnectorFailure, JsonValue } from "../types";

export type OAuthProviderFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function oauthAccessToken(
	providerId: string,
	actionId: string,
	context: ActionExecutionContext,
): ResultType<string, ConnectorProviderUnavailable> {
	const accessToken = context.credentials.accessToken;
	return accessToken
		? Result.ok(accessToken)
		: Result.err(
				new ConnectorProviderUnavailable({
					message: `${providerId} OAuth access token is not configured`,
					data: { providerId, actionId },
				}),
			);
}

export async function oauthJsonRequest(
	providerId: string,
	actionId: string,
	url: string,
	accessToken: string,
	fetcher: OAuthProviderFetcher,
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
				new ConnectorProviderRateLimited({
					message: `${providerId} rate limit exceeded`,
					data: {
						providerId,
						actionId,
						...(retryAfterMs(response) === undefined ? {} : { retryAfterMs: retryAfterMs(response) }),
					},
				}),
			);
		}
		if (response.status >= 500) {
			return Result.err(
				new ConnectorProviderUnavailable({
					message: `${providerId} is temporarily unavailable`,
					data: { providerId, actionId, status: response.status },
				}),
			);
		}
		if (!response.ok) {
			return Result.err(
				new ConnectorProviderFailed({
					message: `${providerId} rejected the request`,
					data: { providerId, actionId, status: response.status },
				}),
			);
		}
		if (response.status === 204) return Result.ok({});
		if (!isJsonValue(payload)) {
			return Result.err(
				new ConnectorProviderFailed({
					message: `${providerId} returned an invalid JSON response`,
					data: { providerId, actionId, status: response.status },
				}),
			);
		}
		return Result.ok(payload);
	} catch (cause) {
		return Result.err(
			new ConnectorProviderUnavailable({
				message: `${providerId} request failed`,
				data: { providerId, actionId },
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
