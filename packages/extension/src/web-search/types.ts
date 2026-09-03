import type { Result as ResultType } from "better-result";

export type WebSearchProviderId = "exa" | "parallel" | "anysearch";

export interface WebSearchQuery {
	readonly query: string;
	readonly limit: number;
}

export interface WebSearchResult {
	readonly title: string;
	readonly url: string;
	readonly snippet?: string;
	readonly content?: string;
	readonly publishedDate?: string;
}

export interface WebSearchResponse {
	readonly provider: WebSearchProviderId;
	readonly results: readonly WebSearchResult[];
}

export type WebSearchProviderResponse = WebSearchResponse;

export type WebSearchFailureKind =
	| "aborted"
	| "authentication"
	| "invalid_request"
	| "invalid_response"
	| "rate_limited"
	| "unavailable";

export interface WebSearchTransport {
	(input: string, init: RequestInit): Promise<Response>;
}

export interface WebSearchProvider {
	readonly id: WebSearchProviderId;
	search(query: WebSearchQuery, signal?: AbortSignal): Promise<ResultType<WebSearchResponse, WebSearchProviderFailure>>;
}

export interface WebSearchProviderFailureInit {
	readonly provider: WebSearchProviderId;
	readonly kind: WebSearchFailureKind;
	readonly message: string;
	readonly status?: number;
	readonly cause?: unknown;
}

export interface WebSearchProviderConfiguration {
	readonly id: WebSearchProviderId;
	readonly enabled: boolean;
	readonly order?: number;
	readonly apiKey?: string;
}

export interface WebSearchExtensionOptions {
	readonly providers?: readonly WebSearchProviderConfiguration[];
	readonly transport?: WebSearchTransport;
	readonly fetchTransport?: WebSearchTransport;
	readonly jinaApiKey?: string;
	readonly lookup?: (hostname: string) => Promise<readonly string[]>;
	readonly random?: () => number;
	readonly timeoutMs?: number;
}

export interface WebSearchAttemptSummary {
	readonly provider: WebSearchProviderId;
	readonly kind: WebSearchFailureKind;
}

export interface WebSearchRuntimeOptions {
	readonly providers: readonly WebSearchProvider[];
	readonly configurations?: readonly WebSearchProviderConfiguration[];
	readonly random: () => number;
}

export interface WebSearchProviderFailure extends Error {
	readonly _tag: "web_search.provider_failed";
	readonly provider: WebSearchProviderId;
	readonly kind: WebSearchFailureKind;
	readonly status?: number;
}
