import {
	findConnectorOAuthApplication,
	OAuthFlowManager,
	OAuthGatewayClient,
	parseConnectorOAuthScopes,
	type OAuthGatewayFetcher,
} from "@jai/connector";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import type { RuntimeAgentSettingsSnapshot, SqliteRuntimeAgentSettings } from "../config";
import { SqliteRuntimeConnectorOAuthIntentStore, type RuntimeConnectorOAuthIntentStoreFailed } from "./oauth-intents";

const defaultOAuthGatewayEndpoint = "https://jai-connector.jayden0.com";
const defaultOAuthFlowTtlMs = 2 * 60_000;

export interface RuntimeConnectorOAuthStart {
	readonly connectorId: string;
	readonly authorizationUrl: string;
	readonly expiresAt: number;
}

export interface RuntimeConnectorOAuthCompletion {
	readonly connectorId: string;
	readonly snapshot: RuntimeAgentSettingsSnapshot;
}

export class RuntimeConnectorOAuthRejected extends TaggedError("runtime_connector_oauth.rejected")<{
	readonly connectorId?: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeConnectorOAuthOperationFailed extends TaggedError("runtime_connector_oauth.operation_failed")<{
	readonly connectorId?: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type RuntimeConnectorOAuthError =
	| RuntimeConnectorOAuthRejected
	| RuntimeConnectorOAuthOperationFailed
	| RuntimeConnectorOAuthIntentStoreFailed;

export interface RuntimeConnectorOAuthController {
	start(connectorId: string): Promise<ResultType<RuntimeConnectorOAuthStart, RuntimeConnectorOAuthError>>;
	complete(callbackUrl: string): Promise<ResultType<RuntimeConnectorOAuthCompletion, RuntimeConnectorOAuthError>>;
	disconnect(connectorId: string): ResultType<RuntimeAgentSettingsSnapshot, RuntimeConnectorOAuthError>;
	recover(): ResultType<void, RuntimeConnectorOAuthIntentStoreFailed>;
	close(): void;
}

/**
 * The Runtime Host owns PKCE flow state, code exchange and the OAuth durable
 * boundary. Desktop only opens a browser and relays its callback URL.
 */
export class RuntimeConnectorOAuth implements RuntimeConnectorOAuthController {
	readonly #flow: OAuthFlowManager;
	readonly #pending = new Map<string, { readonly connectorId: string; readonly expiresAt: number }>();
	readonly #now: () => number;
	readonly #intents: SqliteRuntimeConnectorOAuthIntentStore;

	constructor(
		private readonly settings: SqliteRuntimeAgentSettings,
		options: {
			readonly intents: SqliteRuntimeConnectorOAuthIntentStore;
			readonly gatewayEndpoint?: string;
			readonly fetcher?: OAuthGatewayFetcher;
			readonly now?: () => number;
			readonly flowTtlMs?: number;
		},
	) {
		this.#now = options.now ?? Date.now;
		this.#intents = options.intents;
		this.#flow = new OAuthFlowManager({
			client: new OAuthGatewayClient({
				endpoint: options.gatewayEndpoint ?? defaultOAuthGatewayEndpoint,
				...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
			}),
			now: this.#now,
			ttlMs: options.flowTtlMs ?? defaultOAuthFlowTtlMs,
		});
	}

	start(connectorId: string): Promise<ResultType<RuntimeConnectorOAuthStart, RuntimeConnectorOAuthError>> {
		return this.begin(connectorId);
	}

	async complete(callbackUrl: string): Promise<ResultType<RuntimeConnectorOAuthCompletion, RuntimeConnectorOAuthError>> {
		const callback = parseCallback(callbackUrl);
		if (callback.isErr()) return callback;
		this.removeExpired(callback.value.state);
		const pending = this.#pending.get(callback.value.state);
		const application = pending ? findConnectorOAuthApplication(pending.connectorId) : undefined;
		if (!pending || !application || application.oauthServiceId !== callback.value.oauthServiceId) {
			return Result.err(
				new RuntimeConnectorOAuthRejected({
					message: "OAuth callback does not match a pending Connector authorization",
					connectorId: pending?.connectorId,
				}),
			);
		}
		if (callback.value.error) {
			this.#flow.cancel(callback.value.state);
			this.#pending.delete(callback.value.state);
			return Result.err(
				new RuntimeConnectorOAuthRejected({
					connectorId: pending.connectorId,
					message: callback.value.errorDescription ?? "OAuth authorization was not completed",
				}),
			);
		}

		const intentId = crypto.randomUUID();
		const now = this.nowIso();
		const recorded = this.#intents.start({ id: intentId, connectorId: pending.connectorId, createdAt: now });
		if (recorded.isErr()) return Result.err(recorded.error);

		const token = await this.#flow.complete(callback.value.oauthServiceId, callback.value.state, callback.value.code!);
		this.#pending.delete(callback.value.state);
		if (token.isErr()) {
			void this.#intents.settle(intentId, "failed", this.nowIso());
			return Result.err(
				new RuntimeConnectorOAuthOperationFailed({
					connectorId: pending.connectorId,
					message: token.error.message,
					cause: token.error,
				}),
			);
		}

		const scopes = parseConnectorOAuthScopes(token.value.scope);
		const saved = this.settings.saveConnectorOAuth(
			{
				connectorId: application.id,
				accessToken: token.value.accessToken,
				tokenType: token.value.tokenType,
				...(token.value.refreshToken === undefined ? {} : { refreshToken: token.value.refreshToken }),
				...(token.value.expiresIn === undefined ? {} : { expiresAt: this.#now() + token.value.expiresIn * 1_000 }),
				scopes: scopes.length > 0 ? scopes : application.scopes,
			},
			this.nowIso(),
			{ oauthIntentId: intentId },
		);
		if (saved.isErr()) {
			void this.#intents.settle(intentId, "interrupted", this.nowIso());
			return Result.err(
				new RuntimeConnectorOAuthOperationFailed({
					connectorId: pending.connectorId,
					message: "OAuth token exchange completed but the Runtime Host could not persist its result",
					cause: saved.error,
				}),
			);
		}
		// The settings fact is the real T2. If this bookkeeping update loses a
		// race with a crash, `recover()` will recognize oauthIntentId and repair it.
		void this.#intents.settle(intentId, "completed", this.nowIso());
		return Result.ok({ connectorId: application.id, snapshot: saved.value });
	}

	disconnect(connectorId: string): ResultType<RuntimeAgentSettingsSnapshot, RuntimeConnectorOAuthError> {
		if (!findConnectorOAuthApplication(connectorId)) {
			return Result.err(
				new RuntimeConnectorOAuthRejected({
					connectorId,
					message: "This Connector does not support OAuth authorization",
				}),
			);
		}
		const disconnected = this.settings.disconnectConnectorOAuth(connectorId, this.nowIso());
		if (disconnected.isErr()) {
			return Result.err(
				new RuntimeConnectorOAuthOperationFailed({
					connectorId,
					message: disconnected.error.message,
					cause: disconnected.error,
				}),
			);
		}
		return Result.ok(disconnected.value);
	}

	recover(): ResultType<void, RuntimeConnectorOAuthIntentStoreFailed> {
		return this.#intents.reconcile(this.settings, this.nowIso());
	}

	close(): void {
		this.#pending.clear();
	}

	private async begin(connectorId: string): Promise<ResultType<RuntimeConnectorOAuthStart, RuntimeConnectorOAuthError>> {
		this.removeExpired();
		const application = findConnectorOAuthApplication(connectorId);
		if (!application) {
			return Result.err(
				new RuntimeConnectorOAuthRejected({
					connectorId,
					message: "This Connector does not support OAuth authorization",
				}),
			);
		}
		const started = await this.#flow.begin(application.oauthServiceId, application.scopes);
		if (started.isErr()) {
			return Result.err(
				new RuntimeConnectorOAuthOperationFailed({
					connectorId: application.id,
					message: started.error.message,
					cause: started.error,
				}),
			);
		}
		this.#pending.set(started.value.state, { connectorId: application.id, expiresAt: started.value.expiresAt });
		return Result.ok({
			connectorId: application.id,
			authorizationUrl: started.value.authorizationUrl,
			expiresAt: started.value.expiresAt,
		});
	}

	private removeExpired(exceptState?: string): void {
		const now = this.#now();
		for (const [state, pending] of this.#pending) {
			if (state !== exceptState && pending.expiresAt <= now) this.#pending.delete(state);
		}
	}

	private nowIso(): string {
		return new Date(this.#now()).toISOString();
	}
}

function parseCallback(
	rawUrl: string,
): ResultType<
	{ readonly oauthServiceId: string; readonly state: string; readonly code?: string; readonly error?: string; readonly errorDescription?: string },
	RuntimeConnectorOAuthRejected
> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch (cause) {
		return Result.err(new RuntimeConnectorOAuthRejected({ message: "OAuth callback URL is invalid", cause }));
	}
	const desktopCallback =
		url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port === "43821" && url.pathname === "/v1/oauth/callback";
	const deepLinkCallback = url.protocol === "jai:" && url.hostname === "connector" && url.pathname === "/oauth/callback";
	if (!desktopCallback && !deepLinkCallback) {
		return Result.err(new RuntimeConnectorOAuthRejected({ message: "OAuth callback URL is not recognized" }));
	}
	const oauthServiceId = url.searchParams.get("provider");
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	const error = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");
	if (!oauthServiceId || !state || (!code && !error)) {
		return Result.err(new RuntimeConnectorOAuthRejected({ message: "OAuth callback parameters are incomplete" }));
	}
	return Result.ok({
		oauthServiceId,
		state,
		...(code ? { code } : {}),
		...(error ? { error } : {}),
		...(errorDescription ? { errorDescription } : {}),
	});
}
