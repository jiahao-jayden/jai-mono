import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { createAMapAdapter, createContext7Adapter, createDefaultConnectorService, createMcDonaldsCnAdapter } from "../src/providers";
import type { RequestContext } from "../src/types";

	const context = { requestId: "context7-1", sessionId: "session-1" } satisfies RequestContext;

describe("Context7 Provider Adapter", () => {
	test("uses the v2 library and context endpoints with a service-owned bearer credential", async () => {
		const requests: { url: string; headers: Headers }[] = [];
		const adapter = createContext7Adapter({
			baseUrl: "https://context7.test",
			fetcher: async (input, init) => {
				requests.push({ url: String(input), headers: new Headers(init?.headers) });
				return new Response(JSON.stringify({ results: [{ id: "/vercel/next.js" }] }), { status: 200 });
			},
		});
		const result = await adapter.execute(adapter.actions[0]!, { libraryName: "next", query: "routing" }, {
			...context,
			connection: { alias: "default", providerId: "context7", displayName: "Context7", status: "connected", scopes: [] },
			credentials: { apiKey: "secret-not-for-agent" },
		});
		expect(result.isOk()).toBe(true);
		expect(requests[0]?.url).toContain("/api/v2/libs/search?");
		expect(requests[0]?.url).toContain("libraryName=next");
		expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret-not-for-agent");

		const docs = await adapter.execute(adapter.actions[1]!, { libraryId: "/vercel/next.js", query: "routing", type: "json" }, {
			...context,
			connection: { alias: "default", providerId: "context7", displayName: "Context7", status: "connected", scopes: [] },
			credentials: { apiKey: "secret-not-for-agent" },
		});
		expect(docs.isOk()).toBe(true);
		expect(requests[1]?.url).toContain("/api/v2/context?");
		expect(requests[1]?.url).toContain("libraryId=%2Fvercel%2Fnext.js");
	});

	test("returns a rate-limit failure without exposing provider credentials", async () => {
		const adapter = createContext7Adapter({
			fetcher: async () => new Response(JSON.stringify({ error: "slow down" }), { status: 429, headers: { "retry-after": "2" } }),
		});
		const result = await adapter.execute(adapter.actions[0]!, { libraryName: "next", query: "routing" }, {
			...context,
			connection: { alias: "default", providerId: "context7", displayName: "Context7", status: "connected", scopes: [] },
			credentials: { apiKey: "secret" },
		});
		expect(result.isErr()).toBe(true);
		expect(result.isErr() ? result.error._tag : "").toBe("connector.provider_rate_limited");
		expect(result.isErr() ? result.error.data : {}).toEqual({ providerId: "context7", actionId: "search_libraries", retryAfterMs: 2000 });
	});

	test("default service keeps Context7 disconnected when no service credential is configured", async () => {
		const service = createDefaultConnectorService({ context7ApiKey: undefined });
		const apps = await service.listApps(context);
		const connections = await service.listConnections(context);
		expect(Result.isOk(apps) && apps.value.apps[0]?.providerId).toBe("context7");
		expect(Result.isOk(connections) && connections.value.connections[0]?.status).toBe("disconnected");
	});
});

describe("AMap Provider Adapter", () => {
	test("registers the planned read-only Web Service action set and keeps the key service-owned", async () => {
		const requests: { url: string; headers: Headers }[] = [];
		const adapter = createAMapAdapter({
			baseUrl: "https://amap.test",
			fetcher: async (input, init) => {
				requests.push({ url: String(input), headers: new Headers(init?.headers) });
				return new Response(JSON.stringify({ status: "1", info: "OK", geocodes: [] }), { status: 200 });
			},
		});
		expect(adapter.actions).toHaveLength(15);
		const result = await adapter.execute(adapter.actions[0]!, { address: "上海市" }, {
			...context,
			connection: { alias: "default", providerId: "amap", displayName: "AMap", status: "connected", scopes: [] },
			credentials: { apiKey: "service-secret" },
		});
		expect(result.isOk()).toBe(true);
		expect(requests[0]?.url).toContain("/v3/geocode/geo?");
		expect(requests[0]?.url).toContain("key=service-secret");
		expect(requests[0]?.url).toContain("address=%E4%B8%8A%E6%B5%B7%E5%B8%82");
		expect(requests[0]?.headers.get("authorization")).toBeNull();
	});

	test("projects an AMap provider error without returning the API key", async () => {
		const adapter = createAMapAdapter({
			fetcher: async () => new Response(JSON.stringify({ status: "0", info: "INVALID_USER_KEY" }), { status: 200 }),
		});
		const result = await adapter.execute(adapter.actions[0]!, { address: "上海市" }, {
			...context,
			connection: { alias: "default", providerId: "amap", displayName: "AMap", status: "connected", scopes: [] },
			credentials: { apiKey: "service-secret" },
		});
		expect(result.isErr()).toBe(true);
		expect(result.isErr() ? result.error.message : "").toContain("INVALID_USER_KEY");
		expect(result.isErr() ? JSON.stringify(result.error) : "").not.toContain("service-secret");
	});
});

describe("McDonald's China Provider Adapter", () => {
	test("registers seven actions and signs requests inside the Connector Service", async () => {
		const requests: { url: string; init?: RequestInit }[] = [];
		const adapter = createMcDonaldsCnAdapter({
			now: () => 1_700_000_000_000,
			fetcher: async (input, init) => {
				requests.push({ url: String(input), init });
				return new Response(JSON.stringify({ success: true, code: 0, data: { menu: [] } }), { status: 200 });
			},
		});
		expect(adapter.actions).toHaveLength(7);
		const result = await adapter.execute(adapter.actions.find((action) => action.actionId === "get_menu")!, {
			storeCode: "S1",
			channelCode: "APP",
			orderType: 1,
			dayPartCode: 2,
		}, {
			...context,
			connection: { alias: "default", providerId: "mcdonalds_cn", displayName: "McDonald's China", status: "connected", scopes: [] },
			credentials: { appId: "app-1", merchantId: "merchant-1", signingKey: "signing-secret", environment: "prod" },
		});
		expect(result.isOk()).toBe(true);
		expect(requests[0]?.url).toBe("https://api.open.mcd.cn/products/menu");
		const init = requests[0]?.init;
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe('{"orderType":1,"dayPartCode":2,"channelCode":"APP","storeCode":"S1"}');
		const headers = new Headers(init?.headers);
		expect(headers.get("AppId")).toBe("app-1");
		expect(headers.get("MerchantId")).toBe("merchant-1");
		expect(headers.get("Timestamp")).toBe("1700000000000");
		expect(headers.get("Sign")).toBe(
			createHash("md5").update('AppId=app-1&Body={"orderType":1,"dayPartCode":2,"channelCode":"APP","storeCode":"S1"}&MerchantId=merchant-1&Timestamp=1700000000000&key=signing-secret').digest("hex").toUpperCase(),
		);
		expect(JSON.stringify(result)).not.toContain("signing-secret");
	});
});
