import { createOAuthGatewayApp } from "./app";
import { loadProvidersFromEnvironment, type OAuthGatewayEnvironment } from "./config";

export interface OAuthGatewayWorkerEnv extends OAuthGatewayEnvironment {
	readonly OAUTH_GATEWAY_PROVIDERS: string;
}

export interface OAuthGatewayExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
	readonly props: Record<string, unknown>;
}

export default {
	fetch(
		request: Request,
		env: OAuthGatewayWorkerEnv,
		executionContext: OAuthGatewayExecutionContext,
	): Response | Promise<Response> {
		const providers = loadProvidersFromEnvironment(env);
		if (providers.isErr()) {
			return new Response(
				JSON.stringify({
					error: {
						code: providers.error._tag,
						message: "OAuth Gateway is not configured",
						retryable: false,
					},
				}),
				{ status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } },
			);
		}
		return createOAuthGatewayApp({ providers: providers.value }).fetch(request, env, executionContext);
	},
};
