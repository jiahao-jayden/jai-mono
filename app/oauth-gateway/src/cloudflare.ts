import { createOAuthGatewayApp } from "./app";
import { loadOAuthServicesFromEnvironment, type OAuthGatewayEnvironment } from "./config";

export interface OAuthGatewayWorkerEnv extends OAuthGatewayEnvironment {
	readonly OAUTH_GATEWAY_SERVICES: string;
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
		const services = loadOAuthServicesFromEnvironment(env);
		if (services.isErr()) {
			return new Response(
				JSON.stringify({
					error: {
						code: services.error._tag,
						message: "OAuth Gateway is not configured",
						retryable: false,
					},
				}),
				{ status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } },
			);
		}
		return createOAuthGatewayApp({ services: services.value }).fetch(request, env, executionContext);
	},
};
