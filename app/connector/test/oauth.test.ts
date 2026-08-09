import { describe, expect, test } from "bun:test";
import { ConnectorOAuthFlowInvalid, ConnectorOAuthGatewayFailed, OAuthFlowManager, OAuthGatewayClient } from "../src";

describe("OAuth Gateway SDK", () => {
	test("builds an authorization URL without exposing provider credentials", () => {
		const client = new OAuthGatewayClient({ endpoint: "https://oauth.jai.dev" });
		const url = client.buildAuthorizationUrl({
			providerId: "github",
			state: "state-1",
			codeChallenge: "challenge-1",
			scopes: ["repo"],
		});
		expect(url.toString()).toBe(
			"https://oauth.jai.dev/v1/oauth/github/authorize?state=state-1&code_challenge=challenge-1&code_challenge_method=S256&scope=repo",
		);
		expect(url.toString()).not.toContain("client_secret");
	});

	test("exchanges, refreshes, and revokes through the Gateway DTO", async () => {
		const requests: { url: string; body: unknown }[] = [];
		const client = new OAuthGatewayClient({
			endpoint: "https://oauth.jai.dev",
			fetcher: async (input, init) => {
				requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
				if (String(input).endsWith("/revoke")) {
					return new Response(JSON.stringify({ revoked: true, supported: true }), { status: 200 });
				}
				return new Response(JSON.stringify({ accessToken: "access", tokenType: "Bearer", refreshToken: "refresh", expiresIn: 3600 }), {
					status: 200,
				});
			},
		});
		const exchanged = await client.exchange("github", { code: "code-1", codeVerifier: "verifier-1" });
		const refreshed = await client.refresh("github", "refresh-1");
		const revoked = await client.revoke("github", "access-1");
		expect(exchanged.isOk() ? exchanged.value.accessToken : "").toBe("access");
		expect(refreshed.isOk() ? refreshed.value.refreshToken : "").toBe("refresh");
		expect(revoked.isOk() ? revoked.value.revoked : false).toBe(true);
		expect(requests.map((request) => request.url)).toEqual([
			"https://oauth.jai.dev/v1/oauth/github/token",
			"https://oauth.jai.dev/v1/oauth/github/refresh",
			"https://oauth.jai.dev/v1/oauth/github/revoke",
		]);
	});

	test("projects Gateway failures without leaking the remote body", async () => {
		const client = new OAuthGatewayClient({
			endpoint: "https://oauth.jai.dev",
			fetcher: async () =>
				new Response(JSON.stringify({ error: { code: "oauth_gateway.provider_failed", message: "secret-provider-body" } }), {
					status: 502,
				}),
		});
		const result = await client.refresh("github", "refresh-1");
		expect(result.isErr()).toBe(true);
		expect(result.isErr() && result.error).toBeInstanceOf(ConnectorOAuthGatewayFailed);
		expect(JSON.stringify(result)).not.toContain("secret-provider-body");
	});

	test("keeps state and PKCE verifier in the Connector and consumes the flow once", async () => {
		const client = new OAuthGatewayClient({
			endpoint: "https://oauth.jai.dev",
			fetcher: async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as { readonly codeVerifier?: string };
				expect(body.codeVerifier).toBeString();
				return new Response(JSON.stringify({ accessToken: "access", tokenType: "Bearer" }), { status: 200 });
			},
		});
		let now = 1_000_000;
		const manager = new OAuthFlowManager({ client, now: () => now, ttlMs: 30_000 });
		const started = await manager.begin("github", ["repo"]);
		expect(started.isOk()).toBe(true);
		if (started.isErr()) return;
		const callback = new URL(started.value.authorizationUrl);
		expect(callback.searchParams.get("code_challenge_method")).toBe("S256");
		const completed = await manager.complete("github", started.value.state, "code-1");
		expect(completed.isOk()).toBe(true);
		const replay = await manager.complete("github", started.value.state, "code-1");
		expect(replay.isErr() && replay.error).toBeInstanceOf(ConnectorOAuthFlowInvalid);
		const expiring = await manager.begin("github");
		expect(expiring.isOk()).toBe(true);
		if (expiring.isOk()) {
			now += 31_000;
			const expired = await manager.complete("github", expiring.value.state, "code-1");
			expect(expired.isErr() && expired.error).toBeInstanceOf(ConnectorOAuthFlowInvalid);
		}
	});
});
