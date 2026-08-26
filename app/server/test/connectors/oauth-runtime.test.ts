import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import {
	RuntimeConnectorOAuth,
	SqliteRuntimeAgentSettings,
	SqliteRuntimeConnectorOAuthIntentStore,
} from "../../src";

describe("Runtime Connector OAuth", () => {
	test("records T1 before the exchange and persists the token fact as its T2", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = configuredSettings(database);
			const intents = new SqliteRuntimeConnectorOAuthIntentStore(database);
			let requests: readonly { readonly url: string; readonly body: Record<string, unknown> }[] = [];
			const runtime = new RuntimeConnectorOAuth(settings, {
				intents,
				gatewayEndpoint: "https://oauth.jai.dev",
				now: () => 1_700_000_000_000,
				fetcher: async (input, init) => {
					const recorded = intents.read();
					if (recorded.isErr()) throw recorded.error;
					expect(recorded.value).toHaveLength(1);
					expect(recorded.value[0]?.status).toBe("started");
					requests = [
						...requests,
						{ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> },
					];
					return new Response(
						JSON.stringify({
							accessToken: "github-access-token",
							tokenType: "Bearer",
							refreshToken: "github-refresh-token",
							expiresIn: 60,
							scope: "repo workflow",
						}),
						{ status: 200 },
					);
				},
			});
			const started = await runtime.start("github");
			if (started.isErr()) throw started.error;
			const state = new URL(started.value.authorizationUrl).searchParams.get("state");
			expect(state).toBeString();

			const completed = await runtime.complete(
				`http://127.0.0.1:43821/v1/oauth/callback?provider=github&state=${encodeURIComponent(state!)}&code=one-time-code`,
			);
			if (completed.isErr()) throw completed.error;
			expect(completed.value.connectorId).toBe("github");
			expect(JSON.stringify(completed.value.snapshot)).not.toContain("github-access-token");
			expect(JSON.stringify(completed.value.snapshot)).not.toContain("github-refresh-token");
			expect(requests).toEqual([
			{
				url: "https://oauth.jai.dev/v1/oauth/github/token",
				body: { code: "one-time-code", codeVerifier: expect.any(String) },
			},
		]);

			const recorded = intents.read();
			if (recorded.isErr()) throw recorded.error;
			expect(recorded.value[0]?.status).toBe("completed");
			const connector = settings.readConnectorSettings();
			if (connector.isErr()) throw connector.error;
			expect(connector.value.connectors?.github?.credentials).toMatchObject({
				accessToken: "github-access-token",
				refreshToken: "github-refresh-token",
				oauthIntentId: recorded.value[0]?.id,
			});
		} finally {
			database.close();
		}
	});

	test("records a failed exchange without persisting an OAuth token", async () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = configuredSettings(database);
			const intents = new SqliteRuntimeConnectorOAuthIntentStore(database);
			const runtime = new RuntimeConnectorOAuth(settings, {
				intents,
				gatewayEndpoint: "https://oauth.jai.dev",
				fetcher: async () => new Response(JSON.stringify({ error: { code: "provider_failed" } }), { status: 502 }),
			});
			const started = await runtime.start("github");
			if (started.isErr()) throw started.error;
			const state = new URL(started.value.authorizationUrl).searchParams.get("state");
			const completed = await runtime.complete(
				`http://127.0.0.1:43821/v1/oauth/callback?provider=github&state=${encodeURIComponent(state!)}&code=one-time-code`,
			);
			expect(completed.isErr()).toBe(true);

			const recorded = intents.read();
			if (recorded.isErr()) throw recorded.error;
			expect(recorded.value[0]?.status).toBe("failed");
			const connector = settings.readConnectorSettings();
			if (connector.isErr()) throw connector.error;
			expect(connector.value.connectors?.github?.credentials).not.toHaveProperty("accessToken");
			expect(connector.value.connectors?.github?.credentials).not.toHaveProperty("refreshToken");
		} finally {
			database.close();
		}
	});

	test("recovery completes only a T1 with a correlated token fact and parks every other T1", () => {
		const database = new DatabaseSync(":memory:");
		try {
			const settings = configuredSettings(database);
			const intents = new SqliteRuntimeConnectorOAuthIntentStore(database);
			const now = "2026-08-26T00:00:00.000Z";
			const first = intents.start({ id: "oauth-completed", connectorId: "github", createdAt: now });
			if (first.isErr()) throw first.error;
			const persisted = settings.saveConnectorOAuth(
				{
					connectorId: "github",
					accessToken: "github-access-token",
					tokenType: "Bearer",
					scopes: ["repo"],
				},
				now,
				{ oauthIntentId: "oauth-completed" },
			);
			if (persisted.isErr()) throw persisted.error;
			const second = intents.start({ id: "oauth-unknown", connectorId: "google_drive", createdAt: now });
			if (second.isErr()) throw second.error;

			const runtime = new RuntimeConnectorOAuth(settings, { intents, now: () => Date.parse(now) });
			const recovered = runtime.recover();
			if (recovered.isErr()) throw recovered.error;
			const recorded = intents.read();
			if (recorded.isErr()) throw recorded.error;
			expect(recorded.value).toEqual([
				expect.objectContaining({ id: "oauth-completed", status: "completed" }),
				expect.objectContaining({ id: "oauth-unknown", status: "interrupted" }),
			]);
		} finally {
			database.close();
		}
	});
});

function configuredSettings(database: DatabaseSync): SqliteRuntimeAgentSettings {
	const settings = new SqliteRuntimeAgentSettings(database);
	const configured = settings.write({
		revision: null,
		model: "",
		providers: [],
		connector: { policy: { default: "ask", actions: {} }, connectors: { github: { enabled: true }, google_drive: { enabled: true } } },
	});
	if (configured.isErr()) throw configured.error;
	return settings;
}
