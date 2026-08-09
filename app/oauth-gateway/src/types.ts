export interface OAuthGatewayProvider {
	readonly id: string;
	readonly authorizationEndpoint: string;
	readonly tokenEndpoint: string;
	readonly revokeEndpoint?: string;
	readonly clientId: string;
	readonly clientSecret: string;
	/** The fixed callback registered with the upstream Provider. */
	readonly gatewayCallbackUrl: string;
	/** The fixed callback registered by the Jai desktop application. */
	readonly applicationCallbackUrl: string;
	readonly scopes: readonly string[];
	/** Provider-specific authorization parameters, for example Google's offline-access request. */
	readonly authorizationParams?: Readonly<Record<string, string>>;
}

export interface OAuthGatewayOptions {
	readonly providers: readonly OAuthGatewayProvider[];
	readonly fetcher?: OAuthGatewayFetcher;
}

export type OAuthGatewayFetcher = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export interface OAuthTokenResponse {
	readonly accessToken: string;
	readonly tokenType: string;
	readonly refreshToken?: string;
	readonly expiresIn?: number;
	readonly scope?: string;
}

export interface OAuthGatewayErrorDto {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
}
