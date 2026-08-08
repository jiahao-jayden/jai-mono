import { TaggedError } from "better-result";

export class OAuthGatewayConfigurationInvalid extends TaggedError("oauth_gateway.configuration_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string; readonly providerId?: string };
	readonly message: string;
}> {}

export class OAuthGatewayProviderNotFound extends TaggedError("oauth_gateway.provider_not_found")<{
	readonly data: { readonly providerId: string };
	readonly message: string;
}> {}

export class OAuthGatewayRequestInvalid extends TaggedError("oauth_gateway.request_invalid")<{
	readonly data: { readonly reason: string };
	readonly message: string;
}> {}

export class OAuthGatewayProviderFailed extends TaggedError("oauth_gateway.provider_failed")<{
	readonly cause?: unknown;
	readonly data: {
		readonly providerId: string;
		readonly operation: "token" | "refresh" | "revoke";
		readonly status?: number;
	};
	readonly message: string;
}> {}

export class OAuthGatewayTokenInvalid extends TaggedError("oauth_gateway.token_invalid")<{
	readonly data: { readonly providerId: string; readonly operation: "token" | "refresh" };
	readonly message: string;
}> {}
