import { Result, type Result as ResultType } from "better-result";
import { WebSearchAllProvidersFailed, WebSearchInvalidQuery, WebSearchNoProviders, WebSearchProviderFailed } from "./errors";
import { WebFetchRuntime } from "./fetch";
import type {
	WebSearchAttemptSummary,
	WebSearchFailureKind,
	WebSearchProvider,
	WebSearchProviderConfiguration,
	WebSearchProviderId,
	WebSearchProviderFailure,
	WebSearchResponse,
	WebSearchRuntimeOptions,
} from "./types";

export class WebSearchRuntime {
	readonly #providers: readonly WebSearchProvider[];
	readonly #configurations: readonly WebSearchProviderConfiguration[];
	readonly #random: () => number;
	readonly fetcher: WebFetchRuntime;

	constructor(options: WebSearchRuntimeOptions & { readonly fetcher?: WebFetchRuntime }) {
		this.#providers = options.providers;
		this.#configurations = options.configurations ?? options.providers.map((provider, index) => ({ id: provider.id, enabled: true, order: index + 1 }));
		this.#random = options.random;
		this.fetcher = options.fetcher ?? new WebFetchRuntime();
	}

	async search(
		query: string,
		limit: number,
		signal?: AbortSignal,
	): Promise<ResultType<WebSearchResponse, WebSearchInvalidQuery | WebSearchNoProviders | WebSearchAllProvidersFailed | WebSearchProviderFailure>> {
		if (!query.trim()) return Result.err(new WebSearchInvalidQuery({ message: "Search query must not be empty" }));
		if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
			return Result.err(new WebSearchInvalidQuery({ message: "Search limit must be an integer from 1 to 10" }));
		}
		const providers = this.#orderedProviders();
		if (!providers.length) return Result.err(new WebSearchNoProviders({ message: "No Web Search Provider is configured" }));
		const attempts: WebSearchAttemptSummary[] = [];
		for (const provider of providers) {
			if (signal?.aborted) return Result.err(providerFailureForAbort(provider.id));
			const result = await provider.search({ query: query.trim(), limit }, signal);
			if (result.isOk()) {
				for (const item of result.value.results) {
					if (item.content) {
						this.fetcher.remember({
							url: item.url,
							title: item.title,
							content: item.content,
							mimeType: "text/plain",
							redirects: [],
						});
					}
				}
				return result;
			}
			attempts.push({ provider: provider.id, kind: result.error.kind });
			if (!isFailoverFailure(result.error)) return Result.err(result.error);
		}
		return Result.err(
			new WebSearchAllProvidersFailed({
				message: `All configured Web Search Providers failed: ${attempts.map((attempt) => `${attempt.provider} (${attempt.kind})`).join(", ")}`,
				attempts,
			}),
		);
	}

	#orderedProviders(): readonly WebSearchProvider[] {
		const providerById = new Map(this.#providers.map((provider) => [provider.id, provider]));
		return orderProviderConfigurations(this.#configurations, this.#random)
			.map((configuration) => providerById.get(configuration.id))
			.filter((provider): provider is WebSearchProvider => provider !== undefined);
	}
}

export function orderProviderConfigurations(
	providers: readonly WebSearchProviderConfiguration[],
	random: () => number = Math.random,
): readonly WebSearchProviderConfiguration[] {
	const configured = providers.filter((provider) => provider.enabled);
	const ordered = configured.filter((provider) => provider.order !== undefined).toSorted((left, right) => {
		const orderDifference = left.order! - right.order!;
		return orderDifference || left.id.localeCompare(right.id);
	});
	const unordered = shuffle(configured.filter((provider) => provider.order === undefined), random);
	return ordered.length ? [...ordered, ...unordered] : unordered;
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
	const result = [...values];
	for (let index = result.length - 1; index > 0; index -= 1) {
		const target = Math.floor(random() * (index + 1));
		[result[index], result[target]] = [result[target]!, result[index]!];
	}
	return result;
}

function isFailoverFailure(error: WebSearchProviderFailure): boolean {
	return error.kind === "unavailable" || error.kind === "rate_limited" || error.kind === "invalid_response";
}

function providerFailureForAbort(provider: WebSearchProviderId): WebSearchProviderFailure {
	return new WebSearchProviderFailed({
		message: "Web Search request was cancelled",
		provider,
		kind: "aborted",
	});
}
