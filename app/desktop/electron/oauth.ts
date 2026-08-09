import { OAuthFlowManager, OAuthGatewayClient } from "@jai/connector";
import { TaggedError } from "better-result";
import { shell } from "electron";
import { findDesktopConnectorOAuthApplication } from "./config/connector";
import type { DesktopConfigService } from "./config/index";
import { DesktopOAuthCallbackServer, isDesktopOAuthCallbackUrl } from "./oauth-callback";

const oauthGatewayEndpoint = "https://jai-connector.jayden0.com";
const oauthFlowTtlMs = 2 * 60_000;

class DesktopOAuthCallbackInvalid extends TaggedError("desktop_oauth.callback_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string; readonly connectorId?: string; readonly oauthServiceId?: string };
	readonly message: string;
}> {}

class DesktopOAuthAuthorizationFailed extends TaggedError("desktop_oauth.authorization_failed")<{
	readonly cause?: unknown;
	readonly data: { readonly connectorId: string };
	readonly message: string;
}> {}

export interface DesktopOAuthStartResult {
	readonly connectorId: string;
	readonly expiresAt: number;
}

export interface DesktopOAuthCallbackResult {
	readonly connectorId: string;
}

export class DesktopOAuthManager {
	readonly #config: DesktopConfigService;
	readonly #flow = new OAuthFlowManager({
		client: new OAuthGatewayClient({ endpoint: oauthGatewayEndpoint }),
		ttlMs: oauthFlowTtlMs,
	});
	readonly #openExternal: (url: string) => Promise<void>;
	readonly #callbackServer: DesktopOAuthCallbackServer;
	readonly #connectorsByState = new Map<string, { readonly connectorId: string; readonly expiresAt: number }>();

	constructor(options: {
		readonly config: DesktopConfigService;
		readonly onCallback: (url: string) => Promise<void>;
		readonly openExternal?: (url: string) => Promise<void>;
	}) {
		this.#config = options.config;
		this.#openExternal = options.openExternal ?? shell.openExternal;
		this.#callbackServer = new DesktopOAuthCallbackServer({ onCallback: options.onCallback });
	}

	async start(connectorId: string): Promise<DesktopOAuthStartResult> {
		this.#removeExpiredConnectors();
		const application = findDesktopConnectorOAuthApplication(connectorId);
		if (!application) {
			throw new DesktopOAuthCallbackInvalid({
				message: "This Connector does not support OAuth authorization",
				data: { reason: "connector_not_found", connectorId },
			});
		}
		await this.#callbackServer.start();
		const started = await this.#flow.begin(application.oauthServiceId, application.scopes);
		if (started.isErr()) throw started.error;
		this.#connectorsByState.set(started.value.state, {
			connectorId: application.id,
			expiresAt: started.value.expiresAt,
		});
		try {
			await this.#openExternal(started.value.authorizationUrl);
		} catch (cause) {
			this.#flow.cancel(started.value.state);
			this.#connectorsByState.delete(started.value.state);
			throw new DesktopOAuthAuthorizationFailed({
				message: "The browser could not be opened for OAuth authorization",
				data: { connectorId: application.id },
				cause,
			});
		}
		return {
			connectorId: application.id,
			expiresAt: started.value.expiresAt,
		};
	}

	async handleCallback(rawUrl: string): Promise<DesktopOAuthCallbackResult> {
		const callback = parseOAuthCallback(rawUrl);
		this.#removeExpiredConnectors(callback.state);
		const pending = this.#connectorsByState.get(callback.state);
		const application = pending ? findDesktopConnectorOAuthApplication(pending.connectorId) : undefined;
		if (!application || application.oauthServiceId !== callback.oauthServiceId) {
			throw new DesktopOAuthCallbackInvalid({
				message: "OAuth callback does not match a pending Connector authorization",
				data: { reason: "connector_not_found", oauthServiceId: callback.oauthServiceId },
			});
		}
		if (callback.error) {
			this.#flow.cancel(callback.state);
			this.#connectorsByState.delete(callback.state);
			throw new DesktopOAuthAuthorizationFailed({
				message: callback.errorDescription ?? "OAuth authorization was not completed",
				data: { connectorId: application.id },
			});
		}
		const completed = await this.#flow.complete(application.oauthServiceId, callback.state, callback.code!);
		this.#connectorsByState.delete(callback.state);
		if (completed.isErr()) {
			throw new DesktopOAuthAuthorizationFailed({
				message: completed.error.message,
				data: { connectorId: application.id },
				cause: completed.error,
			});
		}
		await this.#config.saveConnectorOAuth(application.id, completed.value);
		return { connectorId: application.id };
	}

	async disconnect(connectorId: string) {
		const application = findDesktopConnectorOAuthApplication(connectorId);
		if (!application) {
			throw new DesktopOAuthCallbackInvalid({
				message: "This Connector does not support OAuth authorization",
				data: { reason: "connector_not_found", connectorId },
			});
		}
		return this.#config.disconnectConnectorOAuth(application.id);
	}

	close(): Promise<void> {
		this.#connectorsByState.clear();
		return this.#callbackServer.close();
	}

	#removeExpiredConnectors(exceptState?: string): void {
		const now = Date.now();
		for (const [state, pending] of this.#connectorsByState) {
			if (state !== exceptState && pending.expiresAt <= now) this.#connectorsByState.delete(state);
		}
	}
}

function parseOAuthCallback(rawUrl: string): {
	readonly oauthServiceId: string;
	readonly state: string;
	readonly code?: string;
	readonly error?: string;
	readonly errorDescription?: string;
} {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch (cause) {
		throw new DesktopOAuthCallbackInvalid({
			message: "OAuth callback URL is invalid",
			data: { reason: "url_invalid" },
			cause,
		});
	}
	if (
		!isDesktopOAuthCallbackUrl(url) &&
		(url.protocol !== "jai:" || url.hostname !== "connector" || url.pathname !== "/oauth/callback")
	) {
		throw new DesktopOAuthCallbackInvalid({
			message: "OAuth callback URL is not recognized",
			data: { reason: "route_invalid" },
		});
	}
	const oauthServiceId = url.searchParams.get("provider");
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	const error = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");
	if (!oauthServiceId || !state || (!code && !error)) {
		throw new DesktopOAuthCallbackInvalid({
			message: "OAuth callback parameters are incomplete",
			data: { reason: "parameters_invalid", ...(oauthServiceId ? { oauthServiceId } : {}) },
		});
	}
	return {
		oauthServiceId,
		state,
		...(code ? { code } : {}),
		...(error ? { error } : {}),
		...(errorDescription ? { errorDescription } : {}),
	};
}
