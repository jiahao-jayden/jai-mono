import { describe, expect, test } from "bun:test";
import { WebFetchFailed, WebFetchRuntime, type WebFetchTransport } from "../../src/web-search";

const publicLookup = async (): Promise<readonly string[]> => ["93.184.216.34"];

describe("web fetch runtime", () => {
	test("extracts readable HTML, follows safe redirects, and reuses current-operation cache", async () => {
		let calls = 0;
		const transport: WebFetchTransport = async (url) => {
			calls += 1;
			if (url.startsWith("https://r.jina.ai/")) return new Response("Reader unavailable", { status: 503 });
			if (url === "https://example.com/start") {
				return new Response(null, { status: 302, headers: { location: "/page" } });
			}
			return new Response("<html><head><title>Example &amp; page</title><script>alert(1)</script></head><body><h1>Hello</h1><p>Readable text.</p></body></html>", {
				status: 200,
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		};
		const runtime = new WebFetchRuntime({ transport, lookup: publicLookup });
		const first = await runtime.fetch("https://example.com/start");
		expect(first.isOk()).toBe(true);
		if (first.isErr()) return;
		expect(first.value).toMatchObject({
			url: "https://example.com/page",
			title: "Example & page",
			content: "# Hello\n\nReadable text.",
			redirects: ["https://example.com/page"],
		});
		const second = await runtime.fetch("https://example.com/start");
		expect(second).toEqual(first);
		expect(calls).toBe(3);
	});

	test("uses Jina Reader first with or without an API key", async () => {
		const requests: { url: string; headers: Headers }[] = [];
		const transport: WebFetchTransport = async (url, init) => {
			requests.push({ url, headers: new Headers(init.headers) });
			return new Response("# Jina page\n\nReadable Markdown.", {
				status: 200,
				headers: { "content-type": "text/markdown; charset=utf-8" },
			});
		};
		const withoutKey = new WebFetchRuntime({ transport, lookup: publicLookup });
		const first = await withoutKey.fetch("https://example.com/page");
		expect(first.isOk()).toBe(true);
		expect(requests[0]).toMatchObject({ url: "https://r.jina.ai/https://example.com/page" });
		expect(requests[0]?.headers.get("authorization")).toBeNull();
		expect(requests[0]?.headers.get("x-return-format")).toBe("markdown");

		const withKey = new WebFetchRuntime({ transport, jinaApiKey: "jina-secret-1234", lookup: publicLookup });
		const second = await withKey.fetch("https://example.com/other");
		expect(second.isOk()).toBe(true);
		expect(requests[1]?.headers.get("authorization")).toBe("Bearer jina-secret-1234");
		expect(JSON.stringify(second)).not.toContain("jina-secret-1234");
	});

	test("rejects unsafe schemes, hosts, addresses, ports, and redirects", async () => {
		const runtime = new WebFetchRuntime({
			lookup: async (hostname) => (hostname === "public.example" ? ["93.184.216.34"] : ["10.0.0.4"]),
			transport: async (url) => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
		});
		for (const url of [
			"file:///etc/passwd",
			"http://localhost/",
			"http://127.0.0.1/",
			"http://10.0.0.1/",
			"http://public.example:8080/",
		]) {
			const result = await runtime.fetch(url);
			expect(result.isErr()).toBe(true);
			if (result.isOk()) continue;
			expect(result.error).toBeInstanceOf(WebFetchFailed);
		}
		const redirected = await runtime.fetch("https://public.example/start", true);
		expect(redirected.isErr()).toBe(true);
		if (redirected.isErr()) expect(redirected.error.reason).toBe("blocked_target");
	});

	test("rejects non-text MIME types and oversized responses before exposing content", async () => {
		const runtime = new WebFetchRuntime({
			lookup: publicLookup,
			transport: async (url) => url.endsWith("pdf")
				? new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } })
				: new Response("small", { status: 200, headers: { "content-type": "text/plain", "content-length": "1000001" } }),
		});
		const pdf = await runtime.fetch("https://example.com/file.pdf");
		const oversized = await runtime.fetch("https://example.com/large.txt");
		expect(pdf.isErr() && pdf.error.reason).toBe("unsupported_mime");
		expect(oversized.isErr() && oversized.error.reason).toBe("body_too_large");
	});

	test("distinguishes timeout from caller cancellation", async () => {
		const transport: WebFetchTransport = async (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
			});
		const runtime = new WebFetchRuntime({ transport, lookup: publicLookup, timeoutMs: 5 });
		const timeout = await runtime.fetch("https://example.com/slow");
		expect(timeout.isErr() && timeout.error.reason).toBe("timeout");
		const controller = new AbortController();
		const cancelledPromise = runtime.fetch("https://example.com/cancelled", false, controller.signal);
		controller.abort();
		const cancelled = await cancelledPromise;
		expect(cancelled.isErr() && cancelled.error.reason).toBe("aborted");
	});

	test("applies the request timeout while reading a streaming body", async () => {
		const runtime = new WebFetchRuntime({
			lookup: publicLookup,
			timeoutMs: 5,
			transport: async () =>
				new Response(new ReadableStream<Uint8Array>({ start() {} }), {
					status: 200,
					headers: { "content-type": "text/plain" },
				}),
		});
		const result = await runtime.fetch("https://example.com/stream");
		expect(result.isErr() && result.error.reason).toBe("timeout");
	});
});
