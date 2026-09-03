import { TaggedError } from "better-result";
import type { WebSearchFailureKind, WebSearchProviderId } from "./types";

export class WebSearchProviderFailed extends TaggedError("web_search.provider_failed")<{
	readonly provider: WebSearchProviderId;
	readonly kind: WebSearchFailureKind;
	readonly message: string;
	readonly status?: number;
	readonly cause?: unknown;
}> {}

export class WebSearchInvalidQuery extends TaggedError("web_search.invalid_query")<{
	readonly message: string;
}> {}

export class WebSearchNoProviders extends TaggedError("web_search.no_providers")<{
	readonly message: string;
}> {}

export class WebSearchAllProvidersFailed extends TaggedError("web_search.all_providers_failed")<{
	readonly message: string;
	readonly attempts: readonly { readonly provider: WebSearchProviderId; readonly kind: WebSearchFailureKind }[];
}> {}

export function providerFailure(
	provider: WebSearchProviderId,
	kind: WebSearchFailureKind,
	message: string,
	status?: number,
	cause?: unknown,
): WebSearchProviderFailed {
	return new WebSearchProviderFailed({ provider, kind, message, ...(status === undefined ? {} : { status }), cause });
}
