import { TaggedError } from "better-result";

export class OAuthGatewayConfigurationInvalid extends TaggedError("oauth_gateway.configuration_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string; readonly oauthServiceId?: string };
	readonly message: string;
}> {}

export class OAuthGatewayServiceNotFound extends TaggedError("oauth_gateway.service_not_found")<{
	readonly data: { readonly oauthServiceId: string };
	readonly message: string;
}> {}

export class OAuthGatewayRequestInvalid extends TaggedError("oauth_gateway.request_invalid")<{
	readonly data: { readonly reason: string };
	readonly message: string;
}> {}

export class OAuthGatewayUpstreamFailed extends TaggedError("oauth_gateway.upstream_failed")<{
	readonly cause?: unknown;
	readonly data: {
		readonly oauthServiceId: string;
		readonly operation: "token" | "refresh" | "revoke";
		readonly status?: number;
	};
	readonly message: string;
}> {}

export class OAuthGatewayTokenInvalid extends TaggedError("oauth_gateway.token_invalid")<{
	readonly data: { readonly oauthServiceId: string; readonly operation: "token" | "refresh" };
	readonly message: string;
}> {}
