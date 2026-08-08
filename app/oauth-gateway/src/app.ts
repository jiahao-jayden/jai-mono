import { Result, type Result as ResultType } from "better-result";
import { type Context, Hono } from "hono";
import {
	OAuthGatewayConfigurationInvalid,
	OAuthGatewayProviderFailed,
	OAuthGatewayProviderNotFound,
	OAuthGatewayRequestInvalid,
	OAuthGatewayTokenInvalid,
} from "./errors";
import type { OAuthGatewayFetcher, OAuthGatewayOptions, OAuthGatewayProvider, OAuthTokenResponse } from "./types";

const maxOpaqueValueLength = 1024;

export function createOAuthGatewayApp(options: OAuthGatewayOptions): Hono {
	const providers = new Map(options.providers.map((provider) => [provider.id, provider]));
	if (providers.size !== options.providers.length) {
		throw new OAuthGatewayConfigurationInvalid({
			message: "OAuth Gateway provider IDs must be unique",
			data: { reason: "provider_id_duplicate" },
		});
	}
	const fetcher: OAuthGatewayFetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const app = new Hono();

	app.use("*", async (context, next) => {
		await next();
		context.header("cache-control", "no-store");
		context.header("referrer-policy", "no-referrer");
	});

	app.get("/health", (context) => context.json({ status: "ready", stateless: true, providerCount: providers.size }));

	app.get("/v1/oauth/:provider/authorize", (context) => {
		const provider = resolveProvider(context.req.param("provider"), providers);
		if (provider.isErr()) return errorResponse(context, provider.error, 404);
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
		const requestedScopes = parseScopes(context.req.query("scope"), provider.value.scopes);
		if (requestedScopes.isErr()) return errorResponse(context, requestedScopes.error, 400);
		const authorization = new URL(provider.value.authorizationEndpoint);
		authorization.searchParams.set("response_type", "code");
		authorization.searchParams.set("client_id", provider.value.clientId);
		authorization.searchParams.set("redirect_uri", provider.value.gatewayCallbackUrl);
		authorization.searchParams.set("state", state.value);
		authorization.searchParams.set("code_challenge", codeChallenge.value);
		authorization.searchParams.set("code_challenge_method", "S256");
		if (requestedScopes.value.length > 0) authorization.searchParams.set("scope", requestedScopes.value.join(" "));
		return context.redirect(authorization.toString(), 302);
	});

	app.get("/v1/oauth/:provider/callback", (context) => {
		const provider = resolveProvider(context.req.param("provider"), providers);
		if (provider.isErr()) return errorResponse(context, provider.error, 404);
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
		const callback = new URL(provider.value.applicationCallbackUrl);
		callback.searchParams.set("provider", provider.value.id);
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

	app.post("/v1/oauth/:provider/token", async (context) => {
		const provider = resolveProvider(context.req.param("provider"), providers);
		if (provider.isErr()) return errorResponse(context, provider.error, 404);
		const body = await readJson(context);
		if (body.isErr()) return errorResponse(context, body.error, 400);
		const code = requiredBodyString(body.value, "code");
		const codeVerifier = requiredBodyString(body.value, "codeVerifier");
		if (code.isErr()) return errorResponse(context, code.error, 400);
		if (codeVerifier.isErr()) return errorResponse(context, codeVerifier.error, 400);
		const result = await exchangeToken(provider.value, code.value, codeVerifier.value, fetcher);
		return result.isOk() ? context.json(result.value) : providerErrorResponse(context, result.error);
	});

	app.post("/v1/oauth/:provider/refresh", async (context) => {
		const provider = resolveProvider(context.req.param("provider"), providers);
		if (provider.isErr()) return errorResponse(context, provider.error, 404);
		const body = await readJson(context);
		if (body.isErr()) return errorResponse(context, body.error, 400);
		const refreshToken = requiredBodyString(body.value, "refreshToken");
		if (refreshToken.isErr()) return errorResponse(context, refreshToken.error, 400);
		const result = await refreshTokenRequest(provider.value, refreshToken.value, fetcher);
		return result.isOk() ? context.json(result.value) : providerErrorResponse(context, result.error);
	});

	app.post("/v1/oauth/:provider/revoke", async (context) => {
		const provider = resolveProvider(context.req.param("provider"), providers);
		if (provider.isErr()) return errorResponse(context, provider.error, 404);
		const body = await readJson(context);
		if (body.isErr()) return errorResponse(context, body.error, 400);
		const token = requiredBodyString(body.value, "token");
		if (token.isErr()) return errorResponse(context, token.error, 400);
		if (provider.value.revokeEndpoint === undefined) return context.json({ revoked: false, supported: false });
		const result = await revokeToken(provider.value, token.value, fetcher);
		return result.isOk()
			? context.json({ revoked: true, supported: true })
			: providerErrorResponse(context, result.error);
	});

	return app;
}

async function exchangeToken(
	provider: OAuthGatewayProvider,
	code: string,
	codeVerifier: string,
	fetcher: OAuthGatewayFetcher,
): Promise<ResultType<OAuthTokenResponse, OAuthGatewayProviderFailed | OAuthGatewayTokenInvalid>> {
	return requestToken(provider, "token", fetcher, {
		grant_type: "authorization_code",
		code,
		code_verifier: codeVerifier,
		redirect_uri: provider.gatewayCallbackUrl,
	});
}

async function refreshTokenRequest(
	provider: OAuthGatewayProvider,
	refreshToken: string,
	fetcher: OAuthGatewayFetcher,
): Promise<ResultType<OAuthTokenResponse, OAuthGatewayProviderFailed | OAuthGatewayTokenInvalid>> {
	return requestToken(provider, "refresh", fetcher, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function requestToken(
	provider: OAuthGatewayProvider,
	operation: "token" | "refresh",
	fetcher: OAuthGatewayFetcher,
	fields: Readonly<Record<string, string>>,
): Promise<ResultType<OAuthTokenResponse, OAuthGatewayProviderFailed | OAuthGatewayTokenInvalid>> {
	try {
		const response = await fetcher(provider.tokenEndpoint, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body: new URLSearchParams({
				client_id: provider.clientId,
				client_secret: provider.clientSecret,
				...fields,
			}).toString(),
		});
		if (!response.ok) {
			return Result.err(
				new OAuthGatewayProviderFailed({
					message: "OAuth Provider token request failed",
					data: { providerId: provider.id, operation, status: response.status },
				}),
			);
		}
		return normalizeTokenResponse(provider.id, operation, await response.json());
	} catch (cause) {
		return Result.err(
			new OAuthGatewayProviderFailed({
				message: "OAuth Provider token request could not be completed",
				data: { providerId: provider.id, operation },
				cause,
			}),
		);
	}
}

async function revokeToken(
	provider: OAuthGatewayProvider,
	token: string,
	fetcher: OAuthGatewayFetcher,
): Promise<ResultType<true, OAuthGatewayProviderFailed>> {
	try {
		const response = await fetcher(provider.revokeEndpoint!, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body: new URLSearchParams({
				token,
				client_id: provider.clientId,
				client_secret: provider.clientSecret,
			}).toString(),
		});
		if (!response.ok) {
			return Result.err(
				new OAuthGatewayProviderFailed({
					message: "OAuth Provider revoke request failed",
					data: { providerId: provider.id, operation: "revoke", status: response.status },
				}),
			);
		}
		return Result.ok(true);
	} catch (cause) {
		return Result.err(
			new OAuthGatewayProviderFailed({
				message: "OAuth Provider revoke request could not be completed",
				data: { providerId: provider.id, operation: "revoke" },
				cause,
			}),
		);
	}
}

function normalizeTokenResponse(
	providerId: string,
	operation: "token" | "refresh",
	value: unknown,
): ResultType<OAuthTokenResponse, OAuthGatewayTokenInvalid> {
	if (!isRecord(value) || typeof value.access_token !== "string" || value.access_token.length === 0) {
		return Result.err(
			new OAuthGatewayTokenInvalid({
				message: "OAuth Provider returned an invalid token response",
				data: { providerId, operation },
			}),
		);
	}
	const tokenType = typeof value.token_type === "string" && value.token_type.length > 0 ? value.token_type : "Bearer";
	const expiresIn = value.expires_in === undefined ? undefined : value.expires_in;
	if (expiresIn !== undefined && (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn < 0)) {
		return Result.err(
			new OAuthGatewayTokenInvalid({
				message: "OAuth Provider returned an invalid token expiry",
				data: { providerId, operation },
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

function resolveProvider(
	providerId: string,
	providers: ReadonlyMap<string, OAuthGatewayProvider>,
): ResultType<OAuthGatewayProvider, OAuthGatewayProviderNotFound> {
	const provider = providers.get(providerId);
	return provider
		? Result.ok(provider)
		: Result.err(
				new OAuthGatewayProviderNotFound({ message: "OAuth Provider is not configured", data: { providerId } }),
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

function providerErrorResponse(context: Context, error: OAuthGatewayProviderFailed | OAuthGatewayTokenInvalid) {
	return context.json({ error: toErrorDto(error) }, 502);
}

function toErrorDto(error: unknown): { readonly code: string; readonly message: string; readonly retryable: boolean } {
	if (error instanceof OAuthGatewayProviderFailed) {
		return { code: error._tag, message: "OAuth Provider request failed", retryable: true };
	}
	if (error instanceof OAuthGatewayTokenInvalid) {
		return { code: error._tag, message: "OAuth Provider returned an invalid token response", retryable: false };
	}
	if (error instanceof OAuthGatewayProviderNotFound) {
		return { code: error._tag, message: "OAuth Provider is not configured", retryable: false };
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
