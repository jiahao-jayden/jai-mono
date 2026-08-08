# Jai OAuth Gateway

Stateless Hono OAuth Gateway for the Connector. The Gateway never stores OAuth sessions, authorization codes, access tokens, refresh tokens, or user records.

The Connector owns `state`, PKCE `code_verifier`, and persistence in `settings.json`. The Gateway owns Provider client credentials and performs token exchange, refresh, and revoke.

## Runtime adapters

- `src/bun.ts` runs the Hono app with `Bun.serve()` for local development.
- `src/cloudflare.ts` exports the same Hono app through the Cloudflare Worker `fetch` handler.

The core only uses the Web `Request`/`Response` API, Hono, and `fetch`; it does not depend on Bun or Node server APIs.

## Environment

`OAUTH_GATEWAY_PROVIDERS` is a JSON array. Client IDs and secrets are referenced by environment variable name so Cloudflare Secrets can hold them separately:

```json
[
	{
		"id": "example",
		"authorizationEndpoint": "https://provider.example/oauth/authorize",
		"tokenEndpoint": "https://provider.example/oauth/token",
		"revokeEndpoint": "https://provider.example/oauth/revoke",
		"clientIdEnv": "OAUTH_EXAMPLE_CLIENT_ID",
		"clientSecretEnv": "OAUTH_EXAMPLE_CLIENT_SECRET",
		"gatewayCallbackUrl": "https://oauth.example.com/v1/oauth/example/callback",
		"applicationCallbackUrl": "jai://connector/oauth/callback",
		"scopes": ["profile", "email"]
	}
]
```

The Gateway only accepts HTTPS Provider endpoints and the fixed `jai:` application callback. Requested scopes must be a subset of the configured Provider scopes.

For Cloudflare Workers, deploy with the included `wrangler.toml`; set `OAUTH_GATEWAY_PROVIDERS` as a Worker variable and the referenced client IDs/secrets as Worker Secrets. The configuration is loaded per Worker request and is never persisted by the Gateway.

## Routes

```text
GET  /health
GET  /v1/oauth/:provider/authorize
GET  /v1/oauth/:provider/callback
POST /v1/oauth/:provider/token
POST /v1/oauth/:provider/refresh
POST /v1/oauth/:provider/revoke
```

The callback forwards the short-lived authorization code and state to the application. The Connector then calls `/token` with its PKCE verifier. This keeps the Gateway stateless without putting a verifier in server-side session storage.
