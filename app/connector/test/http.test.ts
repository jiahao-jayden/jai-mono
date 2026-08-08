import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import {
	ConnectorRemoteFailure,
	ConnectorProviderFailed,
	HttpConnectorClient,
	MemoryConnectorService,
	startConnectorHttpServer,
	toConnectorErrorDto,
	type ActionDefinition,
	type ConnectionRecord,
	type JsonValue,
	type ProviderAdapter,
	type ProviderDefinition,
} from "../src";

const provider: ProviderDefinition = { id: "demo", displayName: "Demo", authTypes: ["api_key"] };
const action: ActionDefinition = {
	providerId: "demo",
	actionId: "search",
	description: "Search demo records.",
	inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
	outputSchema: { type: "object" },
	requiredScopes: [],
	sideEffect: "read",
	dataSensitivity: "normal",
};
const connection: ConnectionRecord = {
	alias: "default",
	providerId: "demo",
	displayName: "Demo account",
	status: "connected",
	scopes: [],
};

function createService(): MemoryConnectorService {
	const adapter: ProviderAdapter = {
		definition: provider,
		actions: [action],
		execute: async (_action, input) => Result.ok<JsonValue>({ input }),
	};
	return new MemoryConnectorService({ adapters: [adapter], connections: [connection] });
}

describe("Connector HTTP protocol", () => {
	test("discovers and executes through the SDK client", async () => {
		const server = await startConnectorHttpServer(createService(), { runtimeToken: "runtime-secret" });
		try {
			const client = new HttpConnectorClient({ endpoint: server.url, runtimeToken: "runtime-secret" });
			const apps = await client.listApps({ requestId: "apps", sessionId: "session-1" });
			expect(apps.isOk()).toBe(true);
			if (apps.isOk()) expect(apps.value.apps[0]?.providerId).toBe("demo");

			const actions = await client.searchActions({ query: "search" }, { requestId: "search", sessionId: "session-1" });
			expect(actions.isOk()).toBe(true);
			if (actions.isOk()) expect(actions.value.actions[0]?.actionId).toBe("demo.search");

			const result = await client.executeAction(
				{ actionId: "demo.search", connectionAlias: "default", input: { query: "jai" } },
				{ requestId: "execute", sessionId: "session-1" },
			);
			expect(result.isOk()).toBe(true);
			if (result.isOk()) expect(result.value.status).toBe("completed");
			await client.close();
		} finally {
			await server.close();
		}
	});

	test("rejects requests without the service runtime token", async () => {
		const server = await startConnectorHttpServer(createService(), { runtimeToken: "runtime-secret" });
		try {
			const client = new HttpConnectorClient({ endpoint: server.url, runtimeToken: "wrong-token" });
			const result = await client.listApps({ requestId: "apps", sessionId: "session-1" });
			expect(result.isErr()).toBe(true);
			await client.close();
		} finally {
			await server.close();
		}
	});

	test("preserves remote error codes for Agent projection", async () => {
		const client = new HttpConnectorClient({
			endpoint: "http://connector.test/v1",
			fetcher: async () =>
				new Response(
					JSON.stringify({
						protocolVersion: 1,
						requestId: "health",
						ok: false,
						error: { code: "connector.provider_rate_limited", message: "slow down", retryable: true },
					}),
					{ headers: { "content-type": "application/json" } },
				),
		});

		const result = await client.health({ requestId: "health" });
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(ConnectorRemoteFailure);
			if (result.error instanceof ConnectorRemoteFailure) expect(result.error.data.code).toBe("connector.provider_rate_limited");
		}
	});

	test("sends a service cancellation request when a client signal aborts", async () => {
		const calls: string[] = [];
		let releaseRequest: (() => void) | undefined;
		const client = new HttpConnectorClient({
			endpoint: "http://connector.test/v1",
			fetcher: async (input) => {
				const url = String(input);
				calls.push(url);
				if (url.endsWith("/actions/search")) {
					await new Promise<void>((resolve) => {
						releaseRequest = resolve;
					});
				}
				return new Response(
					JSON.stringify({ protocolVersion: 1, requestId: "request-1", ok: true, value: { actions: [], nextCursor: null } }),
					{ headers: { "content-type": "application/json" } },
				);
			},
		});
		const controller = new AbortController();
		const pending = client.searchActions({}, { requestId: "request-1", signal: controller.signal });
		await Promise.resolve();
		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls.some((url) => url.endsWith("/requests/request-1/cancel"))).toBe(true);
		releaseRequest?.();
		const result = await pending;
		expect(result.isErr()).toBe(true);
	});

	test("rejects malformed action DTOs instead of casting them into the service", async () => {
		const server = await startConnectorHttpServer(createService(), { runtimeToken: "runtime-secret" });
		try {
			const response = await fetch(`${server.url}/actions/search`, {
				method: "POST",
				headers: { authorization: "Bearer runtime-secret", "content-type": "application/json" },
				body: JSON.stringify({ query: "demo", unexpected: true }),
			});
			const payload = (await response.json()) as { readonly ok: boolean; readonly error?: { readonly code: string; readonly details?: unknown } };
			expect(payload.ok).toBe(false);
			expect(payload.error?.code).toBe("connector.input_invalid");
			expect(payload.error?.details).toEqual({ actionId: "<request>", reason: "unknown_field:unexpected" });
		} finally {
			await server.close();
		}
	});

	test("projects only allow-listed error details across the wire", () => {
		const dto = toConnectorErrorDto(
			new ConnectorProviderFailed({
				message: "provider leaked body",
				data: { providerId: "demo", actionId: "search", status: 500 },
			}),
			"request-1",
		);
		expect(dto.message).toBe("Connector provider request failed");
		expect(dto.details).toEqual({ providerId: "demo", actionId: "search", status: 500 });
	});
});
