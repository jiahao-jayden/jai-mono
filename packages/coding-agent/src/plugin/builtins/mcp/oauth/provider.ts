import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import type { PendingFlows } from "./pending-flows.js";
import type { TokenStore } from "./token-store.js";

export type JaiOAuthProviderOptions = {
	serverName: string;
	store: TokenStore;
	flows: PendingFlows;
	/** Local callback URL: e.g. http://127.0.0.1:18900/mcp/oauth/callback */
	redirectUrl: string;
	/** Optional client name shown to the auth server. */
	clientName?: string;
	scope?: string;
};

/**
 * MCP SDK OAuth 2.1 client provider。
 *
 * - Token 存到 `~/.jai/mcp-tokens.json`（0o600）
 * - 支持 Dynamic Client Registration（saveClientInformation 实现了）
 * - PKCE：保存 code verifier
 * - redirectToAuthorization 不做实际跳转——只把 URL 通过 PendingFlows 暴露给 UI
 */
export class JaiOAuthProvider implements OAuthClientProvider {
	constructor(private readonly opts: JaiOAuthProviderOptions) {}

	get redirectUrl(): string {
		return this.opts.redirectUrl;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			redirect_uris: [this.opts.redirectUrl],
			client_name: this.opts.clientName ?? "jai-coding-agent",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			...(this.opts.scope ? { scope: this.opts.scope } : {}),
		};
	}

	state(): Promise<string> {
		return Promise.resolve(this.opts.flows.createState(this.opts.serverName));
	}

	async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
		const entry = await this.opts.store.get(this.opts.serverName);
		return entry?.clientInformation;
	}

	async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
		await this.opts.store.patch(this.opts.serverName, { clientInformation: info });
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		const entry = await this.opts.store.get(this.opts.serverName);
		return entry?.tokens;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		// 立即落盘（OpenCode commit 462645817 教训）
		await this.opts.store.patch(this.opts.serverName, { tokens });
	}

	async redirectToAuthorization(url: URL): Promise<void> {
		// 把 URL 暴露给 manager / UI；不做实际跳转
		this.opts.flows.registerAuthUrl(this.opts.serverName, url);
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		await this.opts.store.patch(this.opts.serverName, { codeVerifier });
	}

	async codeVerifier(): Promise<string> {
		const entry = await this.opts.store.get(this.opts.serverName);
		if (!entry?.codeVerifier) {
			throw new Error(`No PKCE code verifier saved for "${this.opts.serverName}"`);
		}
		return entry.codeVerifier;
	}

	async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
		await this.opts.store.clear(this.opts.serverName, scope);
	}
}
