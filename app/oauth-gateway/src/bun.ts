import { createOAuthGatewayApp } from "./app";
import { loadProvidersFromEnvironment } from "./config";

if (import.meta.main) {
	const providers = loadProvidersFromEnvironment(process.env);
	if (providers.isErr()) throw providers.error;
	const port = Number(process.env.PORT ?? "8787");
	if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");
	const app = createOAuthGatewayApp({ providers: providers.value });
	Bun.serve({ port, fetch: app.fetch });
}
