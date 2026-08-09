import { OAuthFlowManager, OAuthGatewayClient } from "@jai/connector";
import { TaggedError } from "better-result";
import { shell } from "electron";
import { findDesktopConnectorOAuthProvider } from "./config/connector";
import type { DesktopConfigService } from "./config/index";
import { DesktopOAuthCallbackServer, isDesktopOAuthCallbackUrl } from "./oauth-callback";

const oauthGatewayEndpoint = "https://jai-connector.jayden0.com";
const oauthFlowTtlMs = 2 * 60_000;

class DesktopOAuthCallbackInvalid extends TaggedError("desktop_oauth.callback_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string; readonly providerId?: string };
	readonly message: string;
}> {}

class DesktopOAuthAuthorizationFailed extends TaggedError("desktop_oauth.authorization_failed")<{
	readonly cause?: unknown;
	readonly data: { readonly providerId: string };
	readonly message: string;
}> {}

export interface DesktopOAuthStartResult {
	readonly providerId: string;
	readonly expiresAt: number;
}

export interface DesktopOAuthCallbackResult {
	readonly providerId: string;
}

export class DesktopOAuthManager {
	readonly #config: DesktopConfigService;
	readonly #flow = new OAuthFlowManager({
		client: new OAuthGatewayClient({ endpoint: oauthGatewayEndpoint }),
		ttlMs: oauthFlowTtlMs,
	});
	readonly #openExternal: (url: string) => Promise<void>;
	readonly #callbackServer: DesktopOAuthCallbackServer;

	constructor(options: {
		readonly config: DesktopConfigService;
		readonly onCallback: (url: string) => Promise<void>;
		readonly openExternal?: (url: string) => Promise<void>;
	}) {
		this.#config = options.config;
		this.#openExternal = options.openExternal ?? shell.openExternal;
		this.#callbackServer = new DesktopOAuthCallbackServer({ onCallback: options.onCallback });
	}

	async start(providerId: string): Promise<DesktopOAuthStartResult> {
		const provider = findDesktopConnectorOAuthProvider(providerId);
		if (!provider) {
			throw new DesktopOAuthCallbackInvalid({
				message: "This Connector does not support OAuth authorization",
				data: { reason: "provider_not_found", providerId },
			});
		}
		await this.#callbackServer.start();
		const started = await this.#flow.begin(provider.id, provider.scopes);
		if (started.isErr()) throw started.error;
		try {
			await this.#openExternal(started.value.authorizationUrl);
		} catch (cause) {
			this.#flow.cancel(started.value.state);
			throw new DesktopOAuthAuthorizationFailed({
				message: "The browser could not be opened for OAuth authorization",
				data: { providerId: provider.id },
				cause,
			});
		}
		return {
			providerId: started.value.providerId,
			expiresAt: started.value.expiresAt,
		};
	}

	async handleCallback(rawUrl: string): Promise<DesktopOAuthCallbackResult> {
		const callback = parseOAuthCallback(rawUrl);
		const provider = findDesktopConnectorOAuthProvider(callback.providerId);
		if (!provider) {
			throw new DesktopOAuthCallbackInvalid({
				message: "OAuth callback references an unknown Connector provider",
				data: { reason: "provider_not_found", providerId: callback.providerId },
			});
		}
		if (callback.error) {
			this.#flow.cancel(callback.state);
			throw new DesktopOAuthAuthorizationFailed({
				message: callback.errorDescription ?? "OAuth authorization was not completed",
				data: { providerId: provider.id },
			});
		}
		const completed = await this.#flow.complete(provider.id, callback.state, callback.code!);
		if (completed.isErr()) throw completed.error;
		await this.#config.saveConnectorOAuth(provider.id, completed.value);
		return { providerId: provider.id };
	}

	async disconnect(providerId: string) {
		const provider = findDesktopConnectorOAuthProvider(providerId);
		if (!provider) {
			throw new DesktopOAuthCallbackInvalid({
				message: "This Connector does not support OAuth authorization",
				data: { reason: "provider_not_found", providerId },
			});
		}
		return this.#config.disconnectConnectorOAuth(provider.id);
	}

	close(): Promise<void> {
		return this.#callbackServer.close();
	}
}

function parseOAuthCallback(rawUrl: string): {
	readonly providerId: string;
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
	const providerId = url.searchParams.get("provider");
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	const error = url.searchParams.get("error");
	const errorDescription = url.searchParams.get("error_description");
	if (!providerId || !state || (!code && !error)) {
		throw new DesktopOAuthCallbackInvalid({
			message: "OAuth callback parameters are incomplete",
			data: { reason: "parameters_invalid", ...(providerId ? { providerId } : {}) },
		});
	}
	return {
		providerId,
		state,
		...(code ? { code } : {}),
		...(error ? { error } : {}),
		...(errorDescription ? { errorDescription } : {}),
	};
}
