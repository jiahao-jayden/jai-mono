import { describe, expect, test } from "bun:test";
import { loadOAuthServicesFromEnvironment } from "../src/config";

const definition = {
	id: "example",
	authorizationEndpoint: "https://service.example/authorize",
	tokenEndpoint: "https://service.example/token",
	clientIdEnv: "EXAMPLE_CLIENT_ID",
	clientSecretEnv: "EXAMPLE_CLIENT_SECRET",
	gatewayCallbackUrl: "https://oauth.example/v1/oauth/example/callback",
	applicationCallbackUrl: "jai://connector/oauth/callback",
		scopes: ["profile"],
		authorizationParams: { prompt: "consent" },
};

describe("OAuth Gateway environment configuration", () => {
	test("resolves client credentials from separate environment secrets", () => {
		const result = loadOAuthServicesFromEnvironment({
			OAUTH_GATEWAY_SERVICES: JSON.stringify([definition]),
			EXAMPLE_CLIENT_ID: "client-id",
			EXAMPLE_CLIENT_SECRET: "client-secret",
		});
		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value[0]?.clientId).toBe("client-id");
			expect(result.value[0]?.clientSecret).toBe("client-secret");
			expect(result.value[0]?.authorizationParams).toEqual({ prompt: "consent" });
		}
	});

	test("rejects an insecure Service endpoint or missing secret", () => {
		const insecure = loadOAuthServicesFromEnvironment({
			OAUTH_GATEWAY_SERVICES: JSON.stringify([{ ...definition, tokenEndpoint: "http://service.example/token" }]),
			EXAMPLE_CLIENT_ID: "client-id",
			EXAMPLE_CLIENT_SECRET: "client-secret",
		});
		expect(insecure.isErr()).toBe(true);
		const missingSecret = loadOAuthServicesFromEnvironment({
			OAUTH_GATEWAY_SERVICES: JSON.stringify([definition]),
			EXAMPLE_CLIENT_ID: "client-id",
		});
		expect(missingSecret.isErr()).toBe(true);
	});

	test("accepts the fixed desktop loopback callback but rejects other HTTP callbacks", () => {
		const loopback = loadOAuthServicesFromEnvironment({
			OAUTH_GATEWAY_SERVICES: JSON.stringify([
				{ ...definition, applicationCallbackUrl: "http://127.0.0.1:43821/v1/oauth/callback" },
			]),
			EXAMPLE_CLIENT_ID: "client-id",
			EXAMPLE_CLIENT_SECRET: "client-secret",
		});
		expect(loopback.isOk()).toBe(true);

		const remote = loadOAuthServicesFromEnvironment({
			OAUTH_GATEWAY_SERVICES: JSON.stringify([
				{ ...definition, applicationCallbackUrl: "http://localhost:43821/v1/oauth/callback" },
			]),
			EXAMPLE_CLIENT_ID: "client-id",
			EXAMPLE_CLIENT_SECRET: "client-secret",
		});
		expect(remote.isErr()).toBe(true);
	});
});
