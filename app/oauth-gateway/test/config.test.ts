import { describe, expect, test } from "bun:test";
import { loadProvidersFromEnvironment } from "../src/config";

const definition = {
	id: "example",
	authorizationEndpoint: "https://provider.example/authorize",
	tokenEndpoint: "https://provider.example/token",
	clientIdEnv: "EXAMPLE_CLIENT_ID",
	clientSecretEnv: "EXAMPLE_CLIENT_SECRET",
	gatewayCallbackUrl: "https://oauth.example/v1/oauth/example/callback",
	applicationCallbackUrl: "jai://connector/oauth/callback",
		scopes: ["profile"],
		authorizationParams: { prompt: "consent" },
};

describe("OAuth Gateway environment configuration", () => {
	test("resolves client credentials from separate environment secrets", () => {
		const result = loadProvidersFromEnvironment({
			OAUTH_GATEWAY_PROVIDERS: JSON.stringify([definition]),
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

	test("rejects an insecure Provider endpoint or missing secret", () => {
		const insecure = loadProvidersFromEnvironment({
			OAUTH_GATEWAY_PROVIDERS: JSON.stringify([{ ...definition, tokenEndpoint: "http://provider.example/token" }]),
			EXAMPLE_CLIENT_ID: "client-id",
			EXAMPLE_CLIENT_SECRET: "client-secret",
		});
		expect(insecure.isErr()).toBe(true);
		const missingSecret = loadProvidersFromEnvironment({
			OAUTH_GATEWAY_PROVIDERS: JSON.stringify([definition]),
			EXAMPLE_CLIENT_ID: "client-id",
		});
		expect(missingSecret.isErr()).toBe(true);
	});

	test("accepts the fixed desktop loopback callback but rejects other HTTP callbacks", () => {
		const loopback = loadProvidersFromEnvironment({
			OAUTH_GATEWAY_PROVIDERS: JSON.stringify([
				{ ...definition, applicationCallbackUrl: "http://127.0.0.1:43821/v1/oauth/callback" },
			]),
			EXAMPLE_CLIENT_ID: "client-id",
			EXAMPLE_CLIENT_SECRET: "client-secret",
		});
		expect(loopback.isOk()).toBe(true);

		const remote = loadProvidersFromEnvironment({
			OAUTH_GATEWAY_PROVIDERS: JSON.stringify([
				{ ...definition, applicationCallbackUrl: "http://localhost:43821/v1/oauth/callback" },
			]),
			EXAMPLE_CLIENT_ID: "client-id",
			EXAMPLE_CLIENT_SECRET: "client-secret",
		});
		expect(remote.isErr()).toBe(true);
	});
});
