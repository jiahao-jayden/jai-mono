import { Result, type Result as ResultType } from "better-result";
import { type Context, Hono } from "hono";
import {
	OAuthGatewayConfigurationInvalid,
	OAuthGatewayRequestInvalid,
	OAuthGatewayServiceNotFound,
	OAuthGatewayTokenInvalid,
	OAuthGatewayUpstreamFailed,
} from "./errors";
import type { OAuthGatewayFetcher, OAuthGatewayOptions, OAuthGatewayService, OAuthTokenResponse } from "./types";

const maxOpaqueValueLength = 1024;

export function createOAuthGatewayApp(options: OAuthGatewayOptions): Hono {
	const services = new Map(options.services.map((service) => [service.id, service]));
	if (services.size !== options.services.length) {
		throw new OAuthGatewayConfigurationInvalid({
			message: "OAuth Gateway service IDs must be unique",
			data: { reason: "service_id_duplicate" },
		});
	}
	const fetcher: OAuthGatewayFetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const app = new Hono();

	app.use("*", async (context, next) => {
		await next();
		context.header("cache-control", "no-store");
		context.header("referrer-policy", "no-referrer");
	});

	app.get("/health", (context) => context.json({ status: "ready", stateless: true, serviceCount: services.size }));

	app.get("/v1/oauth/:service/authorize", (context) => {
		const service = resolveService(context.req.param("service"), services);
		if (service.isErr()) return errorResponse(context, service.error, 404);
		const state = requiredQuery(context.req.query("state"), "state");
		const codeChallenge = requiredQuery(context.req.query("code_challenge"), "code_challenge");
		const method = context.req.query("code_challenge_method") ?? "S256";
		if (state.isErr()) return errorResponse(context, state.error, 400);
		if (codeChallenge.isErr()) return errorResponse(context, codeChallenge.error, 400);
		if (method !== "S256") {
			return errorResponse(
				context,
				new OAuthGatewayRequestInvalid({
					message: "Only S256 PKCE is supported",
					data: { reason: "pkce_method_invalid" },
				}),
				400,
			);
		}
		const requestedScopes = parseScopes(context.req.query("scope"), service.value.scopes);
		if (requestedScopes.isErr()) return errorResponse(context, requestedScopes.error, 400);
		const authorization = new URL(service.value.authorizationEndpoint);
		for (const [key, value] of Object.entries(service.value.authorizationParams ?? {})) {
			authorization.searchParams.set(key, value);
		}
		authorization.searchParams.set("response_type", "code");
		authorization.searchParams.set("client_id", service.value.clientId);
		authorization.searchParams.set("redirect_uri", service.value.gatewayCallbackUrl);
		authorization.searchParams.set("state", state.value);
		authorization.searchParams.set("code_challenge", codeChallenge.value);
		authorization.searchParams.set("code_challenge_method", "S256");
		if (requestedScopes.value.length > 0) authorization.searchParams.set("scope", requestedScopes.value.join(" "));
		return context.redirect(authorization.toString(), 302);
	});

	app.get("/v1/oauth/:service/callback", (context) => {
		const service = resolveService(context.req.param("service"), services);
		if (service.isErr()) return errorResponse(context, service.error, 404);
		const state = context.req.query("state");
		if (!state || state.length > maxOpaqueValueLength) {
			return errorResponse(
				context,
				new OAuthGatewayRequestInvalid({
					message: "OAuth callback state is invalid",
					data: { reason: "state_invalid" },
				}),
				400,
			);
		}
		const callback = new URL(service.value.applicationCallbackUrl);
		callback.searchParams.set("provider", service.value.id);
		callback.searchParams.set("state", state);
		const error = context.req.query("error");
		if (error) {
			callback.searchParams.set("error", safeCallbackValue(error));
			const description = context.req.query("error_description");
			if (description) callback.searchParams.set("error_description", safeCallbackValue(description));
			return context.redirect(callback.toString(), 302);
		}
		const code = context.req.query("code");
		if (!code || code.length > maxOpaqueValueLength) {
			return errorResponse(
				context,
				new OAuthGatewayRequestInvalid({
					message: "OAuth callback code is invalid",
					data: { reason: "code_invalid" },
				}),
				400,
			);
		}
		callback.searchParams.set("code", code);
		return context.redirect(callback.toString(), 302);
	});

	app.post("/v1/oauth/:service/token", async (context) => {
		const service = resolveService(context.req.param("service"), services);
		if (service.isErr()) return errorResponse(context, service.error, 404);
		const body = await readJson(context);
		if (body.isErr()) return errorResponse(context, body.error, 400);
		const code = requiredBodyString(body.value, "code");
		const codeVerifier = requiredBodyString(body.value, "codeVerifier");
		if (code.isErr()) return errorResponse(context, code.error, 400);
		if (codeVerifier.isErr()) return errorResponse(context, codeVerifier.error, 400);
		const result = await exchangeToken(service.value, code.value, codeVerifier.value, fetcher);
		return result.isOk() ? context.json(result.value) : upstreamErrorResponse(context, result.error);
	});

	app.post("/v1/oauth/:service/refresh", async (context) => {
		const service = resolveService(context.req.param("service"), services);
		if (service.isErr()) return errorResponse(context, service.error, 404);
		const body = await readJson(context);
		if (body.isErr()) return errorResponse(context, body.error, 400);
		const refreshToken = requiredBodyString(body.value, "refreshToken");
		if (refreshToken.isErr()) return errorResponse(context, refreshToken.error, 400);
		const result = await refreshTokenRequest(service.value, refreshToken.value, fetcher);
		return result.isOk() ? context.json(result.value) : upstreamErrorResponse(context, result.error);
	});

	app.post("/v1/oauth/:service/revoke", async (context) => {
		const service = resolveService(context.req.param("service"), services);
		if (service.isErr()) return errorResponse(context, service.error, 404);
		const body = await readJson(context);
		if (body.isErr()) return errorResponse(context, body.error, 400);
		const token = requiredBodyString(body.value, "token");
		if (token.isErr()) return errorResponse(context, token.error, 400);
		if (service.value.revokeEndpoint === undefined) return context.json({ revoked: false, supported: false });
		const result = await revokeToken(service.value, token.value, fetcher);
		return result.isOk()
			? context.json({ revoked: true, supported: true })
			: upstreamErrorResponse(context, result.error);
	});

	return app;
}

async function exchangeToken(
	service: OAuthGatewayService,
	code: string,
	codeVerifier: string,
	fetcher: OAuthGatewayFetcher,
): Promise<ResultType<OAuthTokenResponse, OAuthGatewayUpstreamFailed | OAuthGatewayTokenInvalid>> {
	return requestToken(service, "token", fetcher, {
		grant_type: "authorization_code",
		code,
		code_verifier: codeVerifier,
		redirect_uri: service.gatewayCallbackUrl,
	});
}

async function refreshTokenRequest(
	service: OAuthGatewayService,
	refreshToken: string,
	fetcher: OAuthGatewayFetcher,
): Promise<ResultType<OAuthTokenResponse, OAuthGatewayUpstreamFailed | OAuthGatewayTokenInvalid>> {
	return requestToken(service, "refresh", fetcher, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function requestToken(
	service: OAuthGatewayService,
	operation: "token" | "refresh",
	fetcher: OAuthGatewayFetcher,
	fields: Readonly<Record<string, string>>,
): Promise<ResultType<OAuthTokenResponse, OAuthGatewayUpstreamFailed | OAuthGatewayTokenInvalid>> {
	try {
		const response = await fetcher(service.tokenEndpoint, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body: new URLSearchParams({
				client_id: service.clientId,
				client_secret: service.clientSecret,
				...fields,
			}).toString(),
		});
		if (!response.ok) {
			return Result.err(
				new OAuthGatewayUpstreamFailed({
					message: "OAuth Service token request failed",
					data: { oauthServiceId: service.id, operation, status: response.status },
				}),
			);
		}
		return normalizeTokenResponse(service.id, operation, await response.json());
	} catch (cause) {
		return Result.err(
			new OAuthGatewayUpstreamFailed({
				message: "OAuth Service token request could not be completed",
				data: { oauthServiceId: service.id, operation },
				cause,
			}),
		);
	}
}

async function revokeToken(
	service: OAuthGatewayService,
	token: string,
	fetcher: OAuthGatewayFetcher,
): Promise<ResultType<true, OAuthGatewayUpstreamFailed>> {
	try {
		const response = await fetcher(service.revokeEndpoint!, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body: new URLSearchParams({
				token,
				client_id: service.clientId,
				client_secret: service.clientSecret,
			}).toString(),
		});
		if (!response.ok) {
			return Result.err(
				new OAuthGatewayUpstreamFailed({
					message: "OAuth Service revoke request failed",
					data: { oauthServiceId: service.id, operation: "revoke", status: response.status },
				}),
			);
		}
		return Result.ok(true);
	} catch (cause) {
		return Result.err(
			new OAuthGatewayUpstreamFailed({
				message: "OAuth Service revoke request could not be completed",
				data: { oauthServiceId: service.id, operation: "revoke" },
				cause,
			}),
		);
	}
}

function normalizeTokenResponse(
	oauthServiceId: string,
	operation: "token" | "refresh",
	value: unknown,
): ResultType<OAuthTokenResponse, OAuthGatewayTokenInvalid> {
	if (!isRecord(value) || typeof value.access_token !== "string" || value.access_token.length === 0) {
		return Result.err(
			new OAuthGatewayTokenInvalid({
				message: "OAuth Service returned an invalid token response",
				data: { oauthServiceId, operation },
			}),
		);
	}
	const tokenType = typeof value.token_type === "string" && value.token_type.length > 0 ? value.token_type : "Bearer";
	const expiresIn = value.expires_in === undefined ? undefined : value.expires_in;
	if (expiresIn !== undefined && (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn < 0)) {
		return Result.err(
			new OAuthGatewayTokenInvalid({
				message: "OAuth Service returned an invalid token expiry",
				data: { oauthServiceId, operation },
			}),
		);
	}
	return Result.ok({
		accessToken: value.access_token,
		tokenType,
		...(typeof value.refresh_token === "string" && value.refresh_token.length > 0
			? { refreshToken: value.refresh_token }
			: {}),
		...(expiresIn === undefined ? {} : { expiresIn }),
		...(typeof value.scope === "string" ? { scope: value.scope } : {}),
	});
}

function resolveService(
	oauthServiceId: string,
	services: ReadonlyMap<string, OAuthGatewayService>,
): ResultType<OAuthGatewayService, OAuthGatewayServiceNotFound> {
	const service = services.get(oauthServiceId);
	return service
		? Result.ok(service)
		: Result.err(
				new OAuthGatewayServiceNotFound({ message: "OAuth Service is not configured", data: { oauthServiceId } }),
			);
}

function requiredQuery(value: string | undefined, key: string): ResultType<string, OAuthGatewayRequestInvalid> {
	if (value && value.length > 0 && value.length <= maxOpaqueValueLength) return Result.ok(value);
	return Result.err(
		new OAuthGatewayRequestInvalid({ message: `OAuth ${key} is invalid`, data: { reason: `${key}_invalid` } }),
	);
}

function parseScopes(
	value: string | undefined,
	allowed: readonly string[],
): ResultType<readonly string[], OAuthGatewayRequestInvalid> {
	const scopes = value === undefined ? [...allowed] : value.split(/\s+/).filter(Boolean);
	if (scopes.some((scope) => !allowed.includes(scope))) {
		return Result.err(
			new OAuthGatewayRequestInvalid({
				message: "OAuth scope is not allowed",
				data: { reason: "scope_not_allowed" },
			}),
		);
	}
	return Result.ok(scopes);
}

async function readJson(context: Context): Promise<ResultType<Record<string, unknown>, OAuthGatewayRequestInvalid>> {
	try {
		const value: unknown = await context.req.json();
		if (!isRecord(value)) throw new Error("body_not_object");
		return Result.ok(value);
	} catch {
		return Result.err(
			new OAuthGatewayRequestInvalid({ message: "OAuth request body is invalid", data: { reason: "body_invalid" } }),
		);
	}
}

function requiredBodyString(
	body: Record<string, unknown>,
	key: string,
): ResultType<string, OAuthGatewayRequestInvalid> {
	const value = body[key];
	if (typeof value === "string" && value.length > 0 && value.length <= maxOpaqueValueLength) return Result.ok(value);
	return Result.err(
		new OAuthGatewayRequestInvalid({ message: `OAuth ${key} is invalid`, data: { reason: `${key}_invalid` } }),
	);
}

function errorResponse(context: Context, error: unknown, status: 400 | 404 | 502) {
	return context.json({ error: toErrorDto(error) }, status);
}

function upstreamErrorResponse(context: Context, error: OAuthGatewayUpstreamFailed | OAuthGatewayTokenInvalid) {
	return context.json({ error: toErrorDto(error) }, 502);
}

function toErrorDto(error: unknown): { readonly code: string; readonly message: string; readonly retryable: boolean } {
	if (error instanceof OAuthGatewayUpstreamFailed) {
		return { code: error._tag, message: "OAuth Service request failed", retryable: true };
	}
	if (error instanceof OAuthGatewayTokenInvalid) {
		return { code: error._tag, message: "OAuth Service returned an invalid token response", retryable: false };
	}
	if (error instanceof OAuthGatewayServiceNotFound) {
		return { code: error._tag, message: "OAuth Service is not configured", retryable: false };
	}
	if (error instanceof OAuthGatewayRequestInvalid) {
		return { code: error._tag, message: error.message, retryable: false };
	}
	return { code: "oauth_gateway.internal_error", message: "OAuth Gateway request failed", retryable: true };
}

function safeCallbackValue(value: string): string {
	return value.length > 256 ? value.slice(0, 256) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
