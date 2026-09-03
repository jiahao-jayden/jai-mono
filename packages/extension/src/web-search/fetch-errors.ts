import { TaggedError } from "better-result";

export type WebFetchFailureReason =
	| "aborted"
	| "blocked_target"
	| "body_too_large"
	| "dns_failed"
	| "invalid_response"
	| "invalid_url"
	| "network"
	| "redirect_limit"
	| "timeout"
	| "unsupported_mime"
	| "upstream";

export class WebFetchFailed extends TaggedError("web_fetch.failed")<{
	readonly reason: WebFetchFailureReason;
	readonly message: string;
	readonly status?: number;
	readonly cause?: unknown;
}> {}
