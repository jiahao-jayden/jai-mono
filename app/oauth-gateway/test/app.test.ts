import { describe, expect, test } from "bun:test";
import { createOAuthGatewayApp } from "../src/app";
import type { OAuthGatewayProvider } from "../src/types";

const provider: OAuthGatewayProvider = {
	id: "example",
	authorizationEndpoint: "https://provider.example/authorize",
	tokenEndpoint: "https://provider.example/token",
	revokeEndpoint: "https://provider.example/revoke",
	clientId: "client-id",
	clientSecret: "client-secret",
	gatewayCallbackUrl: "https://gateway.example/v1/oauth/example/callback",
	applicationCallbackUrl: "jai://connector/oauth/callback",
	scopes: ["profile", "email"],
	authorizationParams: { access_type: "offline", prompt: "consent" },
};

describe("OAuth Gateway", () => {
	test("builds a provider authorization redirect with PKCE and an allow-listed scope", async () => {
		const app = createOAuthGatewayApp({ providers: [provider] });
		const response = await app.request(
			"/v1/oauth/example/authorize?state=state-1&code_challenge=challenge-1&code_challenge_method=S256&scope=profile",
		);
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get("location") ?? "");
		expect(location.origin).toBe("https://provider.example");
		expect(location.searchParams.get("client_id")).toBe("client-id");
		expect(location.searchParams.get("redirect_uri")).toBe(provider.gatewayCallbackUrl);
		expect(location.searchParams.get("code_challenge")).toBe("challenge-1");
		expect(location.searchParams.get("scope")).toBe("profile");
		expect(location.searchParams.get("access_type")).toBe("offline");
		expect(location.searchParams.get("prompt")).toBe("consent");
	});

	test("forwards the callback code to the fixed application URI without exchanging it", async () => {
		const app = createOAuthGatewayApp({ providers: [provider] });
		const response = await app.request(
			"/v1/oauth/example/callback?code=one-time-code&state=state-1",
		);
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get("location") ?? "");
		expect(location.protocol).toBe("jai:");
		expect(location.searchParams.get("code")).toBe("one-time-code");
		expect(location.searchParams.get("state")).toBe("state-1");
	});

	test("exchanges a code and normalizes the Provider token response", async () => {
		const requests: { url: string; init?: RequestInit }[] = [];
		const app = createOAuthGatewayApp({
			providers: [provider],
			fetcher: async (input, init) => {
				requests.push({ url: String(input), init });
				return new Response(
					JSON.stringify({ access_token: "access", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600, scope: "profile" }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});
		const response = await app.request("/v1/oauth/example/token", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: "code-1", codeVerifier: "verifier-1" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			accessToken: "access",
			refreshToken: "refresh",
			tokenType: "Bearer",
			expiresIn: 3600,
			scope: "profile",
		});
		expect(requests[0]?.url).toBe(provider.tokenEndpoint);
		expect(String(requests[0]?.init?.body)).toContain("client_id=client-id");
		expect(String(requests[0]?.init?.body)).toContain("client_secret=client-secret");
		expect(String(requests[0]?.init?.body)).toContain("code_verifier=verifier-1");
	});

	test("refreshes and revokes without keeping token state", async () => {
		const operations: string[] = [];
		const app = createOAuthGatewayApp({
			providers: [provider],
			fetcher: async (input) => {
				operations.push(String(input));
				return new Response(JSON.stringify({ access_token: "new-access", token_type: "Bearer" }), { status: 200 });
			},
		});
		const refresh = await app.request("/v1/oauth/example/refresh", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ refreshToken: "refresh-1" }),
		});
		expect(refresh.status).toBe(200);
		const revoke = await app.request("/v1/oauth/example/revoke", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: "access-1" }),
		});
		expect(revoke.status).toBe(200);
		expect(await revoke.json()).toEqual({ revoked: true, supported: true });
		expect(operations).toEqual([provider.tokenEndpoint, provider.revokeEndpoint!]);
	});

	test("does not accept an unknown provider or an unconfigured scope", async () => {
		const app = createOAuthGatewayApp({ providers: [provider] });
		const unknown = await app.request("/v1/oauth/missing/authorize?state=s&code_challenge=c");
		expect(unknown.status).toBe(404);
		const scope = await app.request("/v1/oauth/example/authorize?state=s&code_challenge=c&scope=admin");
		expect(scope.status).toBe(400);
	});
});
