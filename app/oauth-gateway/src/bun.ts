import { createOAuthGatewayApp } from "./app";
import { loadOAuthServicesFromEnvironment } from "./config";

if (import.meta.main) {
	const services = loadOAuthServicesFromEnvironment(process.env);
	if (services.isErr()) throw services.error;
	const port = Number(process.env.PORT ?? "8787");
	if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");
	const app = createOAuthGatewayApp({ services: services.value });
	Bun.serve({ port, fetch: app.fetch });
}
