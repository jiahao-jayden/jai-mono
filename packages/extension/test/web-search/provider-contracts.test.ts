import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import {
	WebSearchProviderFailed,
	createWebSearchProvider,
	orderProviderConfigurations,
	type WebSearchProviderConfiguration,
	type WebSearchTransport,
} from "../../src/web-search";

describe("web search provider contracts", () => {
	test("normalizes Exa results and sends the documented request shape", async () => {
		let request: { readonly url: string; readonly init: RequestInit } | undefined;
		const transport: WebSearchTransport = async (url, init) => {
			request = { url, init };
			return Response.json({
				results: [{ title: "Exa result", url: "https://example.com", text: "Extracted page text" }],
			});
		};
		const provider = createWebSearchProvider(
			{ id: "exa", enabled: true, apiKey: "exa-secret" },
			{ transport },
		);
		expect(provider.isOk()).toBe(true);
		if (provider.isErr()) return;

		const result = await provider.value.search({ query: "jai", limit: 3 });
		expect(result).toEqual(
			Result.ok({
				provider: "exa",
				results: [
					{
						title: "Exa result",
						url: "https://example.com",
						snippet: "Extracted page text",
						content: "Extracted page text",
					},
				],
			}),
		);
		expect(request?.url).toBe("https://api.exa.ai/search");
		expect(request?.init.headers).toMatchObject({ "x-api-key": "exa-secret" });
		expect(JSON.parse(String(request?.init.body))).toMatchObject({ query: "jai", numResults: 3 });
	});

	test("normalizes Parallel results and the official AnySearch envelope", async () => {
		const requests: string[] = [];
		const transport: WebSearchTransport = async (url) => {
			requests.push(url);
			return url.includes("parallel")
				? Response.json({ results: [{ title: "Parallel result", url: "https://parallel.example", excerpts: ["Excerpt"] }] })
				: Response.json({ code: 0, message: "success", data: { results: [{ title: "AnySearch result", url: "https://any.example", snippet: "Description" }] } });
		};
		const parallel = createWebSearchProvider({ id: "parallel", enabled: true, apiKey: "parallel-secret" }, { transport });
		const anysearch = createWebSearchProvider({ id: "anysearch", enabled: true, apiKey: "any-secret" }, { transport });
		expect(parallel.isOk() && anysearch.isOk()).toBe(true);
		if (parallel.isErr() || anysearch.isErr()) return;

		const parallelResult = await parallel.value.search({ query: "parallel", limit: 2 });
		const anysearchResult = await anysearch.value.search({ query: "any", limit: 2 });
		expect(parallelResult.isOk()).toBe(true);
		expect(anysearchResult.isOk()).toBe(true);
		if (parallelResult.isOk()) {
			expect(parallelResult.value).toMatchObject({
				provider: "parallel",
				results: [{ title: "Parallel result", content: "Excerpt" }],
			});
		}
		if (anysearchResult.isOk()) {
			expect(anysearchResult.value).toMatchObject({
				provider: "anysearch",
				results: [{ title: "AnySearch result", snippet: "Description" }],
			});
		}
		expect(requests).toEqual(["https://api.parallel.ai/v1/search", "https://api.anysearch.com/v1/search"]);
	});

	test("classifies authentication, rate limits, invalid JSON, and cancellation without leaking bodies", async () => {
		const responses: WebSearchTransport[] = [
			async () => new Response("secret upstream body", { status: 401 }),
			async () => new Response("secret upstream body", { status: 429 }),
			async () => new Response("not-json", { status: 200 }),
			async () => {
				throw new DOMException("cancelled", "AbortError");
			},
		];
		const kinds = [];
		for (const transport of responses) {
			const provider = createWebSearchProvider({ id: "exa", enabled: true, apiKey: "secret" }, { transport });
			expect(provider.isOk()).toBe(true);
			if (provider.isErr()) continue;
			const result = await provider.value.search({ query: "test", limit: 1 });
			expect(result.isErr()).toBe(true);
			if (result.isOk()) continue;
			kinds.push(result.error.kind);
			expect(result.error.message).not.toContain("secret upstream body");
			expect(result.error).toBeInstanceOf(WebSearchProviderFailed);
		}
		expect(kinds).toEqual(["authentication", "rate_limited", "invalid_response", "aborted"]);
	});

	test("turns a timed-out provider request into a recoverable unavailable failure", async () => {
		const provider = createWebSearchProvider(
			{ id: "exa", enabled: true, apiKey: "secret" },
			{
				timeoutMs: 5,
				transport: async (_url, init) =>
					new Promise((_resolve, reject) => {
						init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
					}),
			},
		);
		expect(provider.isOk()).toBe(true);
		if (provider.isErr()) return;
		const result = await provider.value.search({ query: "test", limit: 1 });
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error.kind).toBe("unavailable");
	});
});

describe("web search provider ordering", () => {
	const providers: WebSearchProviderConfiguration[] = [
		{ id: "exa", enabled: true, order: 2 },
		{ id: "parallel", enabled: true },
		{ id: "anysearch", enabled: true, order: 1 },
	];

	test("sorts ordered providers and randomly appends unordered providers", () => {
		expect(orderProviderConfigurations(providers, () => 0)).toEqual([
			{ id: "anysearch", enabled: true, order: 1 },
			{ id: "exa", enabled: true, order: 2 },
			{ id: "parallel", enabled: true },
		]);
	});

	test("randomizes all providers when no order is configured", () => {
		expect(orderProviderConfigurations(providers.map(({ id, enabled }) => ({ id, enabled })), () => 0)).toHaveLength(3);
	});
});
