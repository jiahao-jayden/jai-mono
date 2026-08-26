import { TaggedError } from "better-result";
import { shell } from "electron";
import { findDesktopConnectorOAuthApplication } from "../config/connector";
import type { DesktopConfigService } from "../config";
import { DesktopOAuthCallbackServer } from "./callback-server";

class DesktopOAuthCallbackInvalid extends TaggedError("desktop_oauth.callback_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string; readonly connectorId?: string; readonly oauthServiceId?: string };
	readonly message: string;
}> {}

class DesktopOAuthAuthorizationFailed extends TaggedError("desktop_oauth.authorization_failed")<{
	readonly cause?: unknown;
	readonly data: { readonly connectorId?: string };
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
		const started = await this.#config.startConnectorOAuth(application.id);
		const state = authorizationState(started.authorizationUrl);
		if (!state) {
			throw new DesktopOAuthCallbackInvalid({
				message: "Runtime Host returned an invalid OAuth authorization URL",
				data: { reason: "authorization_url_invalid", connectorId: application.id },
			});
		}
		this.#connectorsByState.set(state, {
			connectorId: application.id,
			expiresAt: started.expiresAt,
		});
		try {
			await this.#openExternal(started.authorizationUrl);
		} catch (cause) {
			this.#connectorsByState.delete(state);
			throw new DesktopOAuthAuthorizationFailed({
				message: "The browser could not be opened for OAuth authorization",
				data: { connectorId: application.id },
				cause,
			});
		}
		return {
			connectorId: application.id,
			expiresAt: started.expiresAt,
		};
	}

	async handleCallback(rawUrl: string): Promise<DesktopOAuthCallbackResult> {
		const state = callbackState(rawUrl);
		this.#removeExpiredConnectors(state);
		const pending = state ? this.#connectorsByState.get(state) : undefined;
		try {
			const connectorId = await this.#config.completeConnectorOAuth(rawUrl);
			if (state) this.#connectorsByState.delete(state);
			return { connectorId };
		} catch (cause) {
			if (state) this.#connectorsByState.delete(state);
			throw new DesktopOAuthAuthorizationFailed({
				message: cause instanceof Error ? cause.message : "OAuth authorization could not be completed",
				data: { ...(pending ? { connectorId: pending.connectorId } : {}) },
				cause,
			});
		}
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

function callbackState(rawUrl: string): string | undefined {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return undefined;
	}
	return url.searchParams.get("state") ?? undefined;
}

function authorizationState(authorizationUrl: string): string | undefined {
	try {
		return new URL(authorizationUrl).searchParams.get("state") ?? undefined;
	} catch {
		return undefined;
	}
}
