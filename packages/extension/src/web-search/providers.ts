import { Result, type Result as ResultType } from "better-result";
import { providerFailure } from "./errors";
import type {
	WebSearchProvider,
	WebSearchProviderId,
	WebSearchProviderFailure,
	WebSearchProviderConfiguration,
	WebSearchProviderResponse,
	WebSearchQuery,
	WebSearchResult,
	WebSearchTransport,
} from "./types";

const DEFAULT_ENDPOINTS: Record<WebSearchProviderId, string> = {
	exa: "https://api.exa.ai/search",
	parallel: "https://api.parallel.ai/v1/search",
	anysearch: "https://api.anysearch.com/v1/search",
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TRANSPORT: WebSearchTransport = (input, init) => fetch(input, init);

export function createWebSearchProvider(
	configuration: WebSearchProviderConfiguration,
	options: { readonly transport?: WebSearchTransport; readonly endpoint?: string; readonly timeoutMs?: number } = {},
): ResultType<WebSearchProvider, WebSearchProviderFailure> {
	if (!configuration.apiKey?.trim()) {
		return Result.err(
			providerFailure(configuration.id, "authentication", `Provider "${configuration.id}" has no API key`),
		);
	}
	const transport = options.transport ?? DEFAULT_TRANSPORT;
	const endpoint = options.endpoint ?? DEFAULT_ENDPOINTS[configuration.id];
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (configuration.id === "exa") return Result.ok(new ExaSearchProvider(configuration.apiKey, endpoint, transport, timeoutMs));
	if (configuration.id === "parallel") {
		return Result.ok(new ParallelSearchProvider(configuration.apiKey, endpoint, transport, timeoutMs));
	}
	return Result.ok(new AnySearchProvider(configuration.apiKey, endpoint, transport, timeoutMs));
}

class ExaSearchProvider implements WebSearchProvider {
	readonly id = "exa" as const;

	constructor(
		private readonly apiKey: string,
		private readonly endpoint: string,
		private readonly transport: WebSearchTransport,
		private readonly timeoutMs: number,
	) {}

	async search(query: WebSearchQuery, signal?: AbortSignal): Promise<ResultType<WebSearchProviderResponse, WebSearchProviderFailure>> {
		return executeProviderRequest(this.id, this.endpoint, this.transport, {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": this.apiKey },
			body: JSON.stringify({
				query: query.query,
				numResults: query.limit,
				type: "auto",
				contents: { text: { maxCharacters: 10_000 } },
			}),
			signal,
		}, decodeExaResponse, this.timeoutMs);
	}
}

class ParallelSearchProvider implements WebSearchProvider {
	readonly id = "parallel" as const;

	constructor(
		private readonly apiKey: string,
		private readonly endpoint: string,
		private readonly transport: WebSearchTransport,
		private readonly timeoutMs: number,
	) {}

	async search(query: WebSearchQuery, signal?: AbortSignal): Promise<ResultType<WebSearchProviderResponse, WebSearchProviderFailure>> {
		return executeProviderRequest(this.id, this.endpoint, this.transport, {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": this.apiKey },
			body: JSON.stringify({
				objective: query.query,
				search_queries: [query.query],
				max_results: query.limit,
				excerpts: { max_chars: 10_000 },
			}),
			signal,
		}, decodeParallelResponse, this.timeoutMs);
	}
}

class AnySearchProvider implements WebSearchProvider {
	readonly id = "anysearch" as const;

	constructor(
		private readonly apiKey: string,
		private readonly endpoint: string,
		private readonly transport: WebSearchTransport,
		private readonly timeoutMs: number,
	) {}

	async search(query: WebSearchQuery, signal?: AbortSignal): Promise<ResultType<WebSearchProviderResponse, WebSearchProviderFailure>> {
		return executeProviderRequest(this.id, this.endpoint, this.transport, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({ query: query.query, max_results: query.limit }),
			signal,
		}, decodeAnySearchResponse, this.timeoutMs);
	}
}

async function executeProviderRequest(
	provider: WebSearchProviderId,
	endpoint: string,
	transport: WebSearchTransport,
	init: RequestInit,
	decode: (provider: WebSearchProviderId, body: unknown) => ResultType<WebSearchProviderResponse, WebSearchProviderFailure>,
	timeoutMs: number,
): Promise<ResultType<WebSearchProviderResponse, WebSearchProviderFailure>> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const requestSignal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
	try {
		const response = await transport(endpoint, { ...init, signal: requestSignal });
		if (!response.ok) return Result.err(classifyStatus(provider, response.status));
		let body: unknown;
		try {
			body = await readJson(response, requestSignal);
		} catch (cause) {
			if (requestSignal.aborted) throw cause;
			return Result.err(providerFailure(provider, "invalid_response", "Provider returned invalid JSON", response.status, cause));
		}
		return decode(provider, body);
	} catch (cause) {
		if (init.signal?.aborted) {
			return Result.err(providerFailure(provider, "aborted", "Provider request was cancelled", undefined, cause));
		}
		if (timeout.aborted) return Result.err(providerFailure(provider, "unavailable", "Provider request timed out", undefined, cause));
		if (isAbortError(cause)) return Result.err(providerFailure(provider, "aborted", "Provider request was cancelled", undefined, cause));
		return Result.err(providerFailure(provider, "unavailable", "Provider request failed", undefined, cause));
	}
}

function classifyStatus(provider: WebSearchProviderId, status: number): WebSearchProviderFailure {
	if (status === 401 || status === 403) return providerFailure(provider, "authentication", "Provider rejected the API key", status);
	if (status === 429) return providerFailure(provider, "rate_limited", "Provider rate limit exceeded", status);
	if (status >= 500) return providerFailure(provider, "unavailable", "Provider service is unavailable", status);
	return providerFailure(provider, "invalid_request", `Provider rejected the request with HTTP ${status}`, status);
}

function decodeExaResponse(
	provider: WebSearchProviderId,
	body: unknown,
): ResultType<WebSearchProviderResponse, WebSearchProviderFailure> {
	if (!isRecord(body) || !Array.isArray(body.results)) return invalidResponse(provider);
	const results = body.results.map((item) => normalizeResult(item)).filter(isSearchResult);
	if (results.length !== body.results.length) return invalidResponse(provider);
	return Result.ok({ provider, results });
}

function decodeParallelResponse(
	provider: WebSearchProviderId,
	body: unknown,
): ResultType<WebSearchProviderResponse, WebSearchProviderFailure> {
	if (!isRecord(body) || !Array.isArray(body.results)) return invalidResponse(provider);
	const results = body.results.map((item) => normalizeResult(item)).filter(isSearchResult);
	if (results.length !== body.results.length) return invalidResponse(provider);
	return Result.ok({ provider, results });
}

function decodeAnySearchResponse(
	provider: WebSearchProviderId,
	body: unknown,
): ResultType<WebSearchProviderResponse, WebSearchProviderFailure> {
	if (
		!isRecord(body) ||
		typeof body.code !== "number" ||
		body.code !== 0 ||
		!isRecord(body.data) ||
		!Array.isArray(body.data.results)
	)
		return invalidResponse(provider);
	const resultsValue = body.data.results;
	const results = resultsValue.map((item) => normalizeResult(item)).filter(isSearchResult);
	if (results.length !== resultsValue.length) return invalidResponse(provider);
	return Result.ok({ provider, results });
}

function normalizeResult(value: unknown): WebSearchResult | undefined {
	if (!isRecord(value) || typeof value.url !== "string" || !value.url.trim()) return undefined;
	const title = firstString(value.title, value.name) ?? value.url;
	const snippet = firstString(value.snippet, value.description, value.excerpt, value.text);
	const content = firstString(value.content, value.text, value.excerpts);
	const publishedDate = firstString(value.publishedDate, value.published_date, value.publishedAt);
	return {
		title: title.trim(),
		url: value.url.trim(),
		...(snippet ? { snippet: snippet.trim() } : {}),
		...(content ? { content: content.trim() } : {}),
		...(publishedDate ? { publishedDate: publishedDate.trim() } : {}),
	};
}

function invalidResponse(provider: WebSearchProviderId): ResultType<never, WebSearchProviderFailure> {
	return Result.err(providerFailure(provider, "invalid_response", "Provider response did not match the supported schema"));
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value;
		if (Array.isArray(value)) {
			const text = value.filter((item): item is string => typeof item === "string").join("\n").trim();
			if (text) return text;
		}
	}
	return undefined;
}

function isSearchResult(value: WebSearchResult | undefined): value is WebSearchResult {
	return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(value: unknown): boolean {
	return value instanceof DOMException && value.name === "AbortError";
}

function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
	if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			cleanup();
			reject(new DOMException("aborted", "AbortError"));
		};
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		signal.addEventListener("abort", onAbort, { once: true });
		response.json().then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(error) => {
				cleanup();
				reject(error);
			},
		);
	});
}
