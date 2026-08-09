import { Result, type Result as ResultType } from "better-result";
import { ConnectorOAuthFlowInvalid, ConnectorOAuthGatewayFailed, ConnectorProtocolInvalid } from "./errors";

export interface OAuthGatewayClientOptions {
	readonly endpoint: string;
	readonly fetcher?: OAuthGatewayFetcher;
}

export type OAuthGatewayFetcher = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export interface OAuthAuthorizationUrlInput {
	readonly providerId: string;
	readonly state: string;
	readonly codeChallenge: string;
	readonly scopes?: readonly string[];
}

export interface OAuthTokenResponse {
	readonly accessToken: string;
	readonly tokenType: string;
	readonly refreshToken?: string;
	readonly expiresIn?: number;
	readonly scope?: string;
}

export interface OAuthRevokeResponse {
	readonly revoked: boolean;
	readonly supported: boolean;
}

export type OAuthGatewayClientFailure = ConnectorOAuthGatewayFailed | ConnectorProtocolInvalid;

export interface OAuthFlowManagerOptions {
	readonly client: OAuthGatewayClient;
	readonly now?: () => number;
	readonly ttlMs?: number;
}

export interface OAuthFlowStart {
	readonly providerId: string;
	readonly authorizationUrl: string;
	readonly state: string;
	readonly expiresAt: number;
}

interface PendingOAuthFlow {
	readonly providerId: string;
	readonly codeVerifier: string;
	readonly expiresAt: number;
}

export class OAuthFlowManager {
	readonly #client: OAuthGatewayClient;
	readonly #now: () => number;
	readonly #ttlMs: number;
	readonly #pending = new Map<string, PendingOAuthFlow>();

	constructor(options: OAuthFlowManagerOptions) {
		this.#client = options.client;
		this.#now = options.now ?? Date.now;
		this.#ttlMs = options.ttlMs ?? 10 * 60_000;
		if (!Number.isInteger(this.#ttlMs) || this.#ttlMs < 30_000 || this.#ttlMs > 30 * 60_000) {
			throw new ConnectorProtocolInvalid({
				message: "OAuth flow TTL is outside the supported range",
				data: { reason: "oauth_flow_ttl_invalid" },
			});
		}
	}

	async begin(
		providerId: string,
		scopes?: readonly string[],
	): Promise<ResultType<OAuthFlowStart, ConnectorProtocolInvalid>> {
		this.#removeExpired();
		const state = randomSecret();
		const codeVerifier = randomSecret();
		const codeChallenge = await sha256Base64Url(codeVerifier);
		const expiresAt = this.#now() + this.#ttlMs;
		this.#pending.set(state, { providerId, codeVerifier, expiresAt });
		return Result.ok({
			providerId,
			authorizationUrl: this.#client
				.buildAuthorizationUrl({ providerId, state, codeChallenge, ...(scopes === undefined ? {} : { scopes }) })
				.toString(),
			state,
			expiresAt,
		});
	}

	async complete(
		providerId: string,
		state: string,
		code: string,
	): Promise<ResultType<OAuthTokenResponse, OAuthGatewayClientFailure | ConnectorOAuthFlowInvalid>> {
		this.#removeExpired(state);
		const pending = this.#pending.get(state);
		if (!pending) {
			return Result.err(
				new ConnectorOAuthFlowInvalid({
					message: "OAuth flow was not found or has already been consumed",
					data: { providerId, reason: "missing" },
				}),
			);
		}
		if (pending.expiresAt <= this.#now()) {
			this.#pending.delete(state);
			return Result.err(
				new ConnectorOAuthFlowInvalid({
					message: "OAuth flow has expired",
					data: { providerId, reason: "expired" },
				}),
			);
		}
		if (pending.providerId !== providerId) {
			return Result.err(
				new ConnectorOAuthFlowInvalid({
					message: "OAuth callback Provider does not match the flow",
					data: { providerId, reason: "mismatch" },
				}),
			);
		}
		this.#pending.delete(state);
		return this.#client.exchange(providerId, { code, codeVerifier: pending.codeVerifier });
	}

	cancel(state: string): void {
		this.#pending.delete(state);
	}

	#removeExpired(exceptState?: string): void {
		const now = this.#now();
		for (const [state, pending] of this.#pending) {
			if (state !== exceptState && pending.expiresAt <= now) this.#pending.delete(state);
		}
	}
}

export class OAuthGatewayClient {
	readonly #baseUrl: URL;
	readonly #fetcher: OAuthGatewayFetcher;

	constructor(options: OAuthGatewayClientOptions) {
		try {
			this.#baseUrl = new URL(options.endpoint);
		} catch (cause) {
			throw new ConnectorProtocolInvalid({
				message: "OAuth Gateway endpoint is invalid",
				data: { reason: "oauth_gateway_endpoint_invalid" },
				cause,
			});
		}
		if (this.#baseUrl.protocol !== "https:" && this.#baseUrl.protocol !== "http:") {
			throw new ConnectorProtocolInvalid({
				message: "OAuth Gateway endpoint must use HTTP or HTTPS",
				data: { reason: "oauth_gateway_protocol_invalid" },
			});
		}
		this.#baseUrl.search = "";
		this.#baseUrl.hash = "";
		this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	}

	buildAuthorizationUrl(input: OAuthAuthorizationUrlInput): URL {
		const url = this.#route(input.providerId, "authorize");
		url.searchParams.set("state", input.state);
		url.searchParams.set("code_challenge", input.codeChallenge);
		url.searchParams.set("code_challenge_method", "S256");
		if (input.scopes && input.scopes.length > 0) url.searchParams.set("scope", input.scopes.join(" "));
		return url;
	}

	exchange(
		providerId: string,
		input: { readonly code: string; readonly codeVerifier: string },
	): Promise<ResultType<OAuthTokenResponse, OAuthGatewayClientFailure>> {
		return this.#requestToken(providerId, "token", input);
	}

	refresh(
		providerId: string,
		refreshToken: string,
	): Promise<ResultType<OAuthTokenResponse, OAuthGatewayClientFailure>> {
		return this.#requestToken(providerId, "refresh", { refreshToken });
	}

	async revoke(
		providerId: string,
		token: string,
	): Promise<ResultType<OAuthRevokeResponse, OAuthGatewayClientFailure>> {
		const result = await this.#request(providerId, "revoke", { token });
		if (result.isErr()) return result;
		if (
			!isRecord(result.value) ||
			typeof result.value.revoked !== "boolean" ||
			typeof result.value.supported !== "boolean"
		) {
			return Result.err(
				new ConnectorProtocolInvalid({
					message: "OAuth Gateway revoke response is invalid",
					data: { reason: "oauth_revoke_response_invalid" },
				}),
			);
		}
		return Result.ok(result.value as unknown as OAuthRevokeResponse);
	}

	async #requestToken(
		providerId: string,
		operation: "token" | "refresh",
		input: Readonly<Record<string, string>>,
	): Promise<ResultType<OAuthTokenResponse, OAuthGatewayClientFailure>> {
		const result = await this.#request(providerId, operation, input);
		if (result.isErr()) return result;
		const token = normalizeTokenResponse(result.value);
		if (token.isOk()) return Result.ok(token.value);
		return Result.err(
			new ConnectorProtocolInvalid({
				message: "OAuth Gateway token response is invalid",
				data: { reason: "oauth_token_response_invalid" },
			}),
		);
	}

	async #request(
		providerId: string,
		operation: "token" | "refresh" | "revoke",
		input: Readonly<Record<string, string>>,
	): Promise<ResultType<unknown, OAuthGatewayClientFailure>> {
		let response: Response;
		try {
			response = await this.#fetcher(this.#route(providerId, operation), {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify(input),
			});
		} catch (cause) {
			return Result.err(
				new ConnectorOAuthGatewayFailed({
					message: "OAuth Gateway request failed",
					data: { providerId, operation },
					cause,
				}),
			);
		}
		const body = await readResponseBody(response);
		if (!response.ok) {
			const remote = isRecord(body) && isRecord(body.error) ? body.error : undefined;
			return Result.err(
				new ConnectorOAuthGatewayFailed({
					message: "OAuth Gateway rejected the request",
					data: {
						providerId,
						operation,
						status: response.status,
						...(typeof remote?.code === "string" ? { code: remote.code } : {}),
					},
				}),
			);
		}
		if (body === undefined) {
			return Result.err(
				new ConnectorProtocolInvalid({
					message: "OAuth Gateway returned an empty response",
					data: { reason: "oauth_response_empty" },
				}),
			);
		}
		return Result.ok(body);
	}

	#route(providerId: string, operation: "authorize" | "token" | "refresh" | "revoke"): URL {
		const url = new URL(this.#baseUrl);
		const basePath = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
		url.pathname = `${basePath}/v1/oauth/${encodeURIComponent(providerId)}/${operation}`;
		url.search = "";
		return url;
	}
}

function normalizeTokenResponse(value: unknown): ResultType<OAuthTokenResponse, true> {
	if (!isRecord(value) || typeof value.accessToken !== "string" || typeof value.tokenType !== "string") {
		return Result.err(true);
	}
	if (value.expiresIn !== undefined && (typeof value.expiresIn !== "number" || !Number.isFinite(value.expiresIn))) {
		return Result.err(true);
	}
	return Result.ok({
		accessToken: value.accessToken,
		tokenType: value.tokenType,
		...(typeof value.refreshToken === "string" ? { refreshToken: value.refreshToken } : {}),
		...(value.expiresIn === undefined ? {} : { expiresIn: value.expiresIn }),
		...(typeof value.scope === "string" ? { scope: value.scope } : {}),
	});
}

async function readResponseBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function randomSecret(): string {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	return base64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
