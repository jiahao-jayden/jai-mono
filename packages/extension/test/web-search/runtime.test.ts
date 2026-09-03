import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import {
	WebSearchAllProvidersFailed,
	WebSearchInvalidQuery,
	WebSearchProviderFailed,
	WebSearchRuntime,
	createWebSearchExtension,
	type WebSearchProvider,
} from "../../src/web-search";

function provider(
	id: "exa" | "parallel" | "anysearch",
	result: ReturnType<typeof Result.ok> | ReturnType<typeof Result.err>,
	called: string[],
): WebSearchProvider {
	return {
		id,
		async search() {
			called.push(id);
			return result as never;
		},
	};
}

describe("web search runtime", () => {
	test("fails over on rate limits and server failures, then returns the first success", async () => {
		const called: string[] = [];
		const runtime = new WebSearchRuntime({
			providers: [
				provider("exa", Result.err(new WebSearchProviderFailed({ provider: "exa", kind: "rate_limited", message: "limited" })), called),
				provider("parallel", Result.err(new WebSearchProviderFailed({ provider: "parallel", kind: "unavailable", message: "down" })), called),
				provider("anysearch", Result.ok({ provider: "anysearch", results: [] }), called),
			],
			random: () => 0,
		});
		const result = await runtime.search("jai", 5);
		expect(result).toEqual(Result.ok({ provider: "anysearch", results: [] }));
		expect(called).toEqual(["exa", "parallel", "anysearch"]);
	});

	test("does not fail over on authentication or invalid request failures", async () => {
		const called: string[] = [];
		const runtime = new WebSearchRuntime({
			providers: [
				provider("exa", Result.err(new WebSearchProviderFailed({ provider: "exa", kind: "authentication", message: "bad key" })), called),
				provider("parallel", Result.ok({ provider: "parallel", results: [] }), called),
			],
			random: () => 0,
		});
		const result = await runtime.search("jai", 5);
		expect(result.isErr()).toBe(true);
		if (result.isOk()) return;
		expect(result.error).toMatchObject({ kind: "authentication" });
		expect(called).toEqual(["exa"]);
	});

	test("summarizes all recoverable failures without exposing response bodies", async () => {
		const called: string[] = [];
		const runtime = new WebSearchRuntime({
			providers: [
				provider("exa", Result.err(new WebSearchProviderFailed({ provider: "exa", kind: "invalid_response", message: "invalid" })), called),
				provider("parallel", Result.err(new WebSearchProviderFailed({ provider: "parallel", kind: "unavailable", message: "down" })), called),
			],
			random: () => 0,
		});
		const result = await runtime.search("jai", 5);
		expect(result.isErr()).toBe(true);
		if (result.isOk()) return;
		expect(result.error).toBeInstanceOf(WebSearchAllProvidersFailed);
		expect(result.error).toMatchObject({
			attempts: [
				{ provider: "exa", kind: "invalid_response" },
				{ provider: "parallel", kind: "unavailable" },
			],
		});
		expect(result.error.message).not.toContain("response body");
	});

	test("validates input and cancellation before invoking a provider", async () => {
		const called: string[] = [];
		const runtime = new WebSearchRuntime({
			providers: [provider("exa", Result.ok({ provider: "exa", results: [] }), called)],
			random: () => 0,
		});
		const empty = await runtime.search("  ", 5);
		expect(empty.isErr() && empty.error).toBeInstanceOf(WebSearchInvalidQuery);
		const controller = new AbortController();
		controller.abort();
		const cancelled = await runtime.search("jai", 5, controller.signal);
		expect(cancelled.isErr()).toBe(true);
		expect(called).toEqual([]);
	});

	test("recomputes provider order for each search call", async () => {
		const called: string[] = [];
		let randomCalls = 0;
		const runtime = new WebSearchRuntime({
			providers: [
				provider("exa", Result.err(new WebSearchProviderFailed({ provider: "exa", kind: "unavailable", message: "down" })), called),
				provider("parallel", Result.err(new WebSearchProviderFailed({ provider: "parallel", kind: "unavailable", message: "down" })), called),
			],
			configurations: [
				{ id: "exa", enabled: true },
				{ id: "parallel", enabled: true },
			],
			random: () => {
				randomCalls += 1;
				return randomCalls === 1 ? 0 : 0.99;
			},
		});

		await runtime.search("first", 1);
		await runtime.search("second", 1);
		expect(called).toEqual(["parallel", "exa", "exa", "parallel"]);
	});
});

describe("web search extension", () => {
	test("declares one static web_search tool with a strict schema", () => {
		const extension = createWebSearchExtension();
		expect(extension.id).toBe("jai.web-search");
		expect(extension.tools?.map((tool) => tool.name)).toEqual(["web_search", "web_fetch"]);
		expect(extension.tools?.map((tool) => tool.authorization)).toEqual([
		{
			owner: "core",
			permission: { sideEffect: "read", dataSensitivity: "normal", reason: "Search the public web" },
		},
		{
			owner: "core",
			permission: { sideEffect: "read", dataSensitivity: "normal", reason: "Fetch public web content" },
		},
	]);
		expect(extension.catalogs).toBeUndefined();
	});
});
