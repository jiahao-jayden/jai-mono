import { Result, type Result as ResultType } from "better-result";
import { OAuthGatewayConfigurationInvalid } from "./errors";
import type { OAuthGatewayProvider } from "./types";

interface ProviderEnvironmentDefinition {
	readonly id: string;
	readonly authorizationEndpoint: string;
	readonly tokenEndpoint: string;
	readonly revokeEndpoint?: string;
	readonly clientIdEnv: string;
	readonly clientSecretEnv: string;
	readonly gatewayCallbackUrl: string;
	readonly applicationCallbackUrl: string;
	readonly scopes: readonly string[];
	readonly authorizationParams?: Readonly<Record<string, string>>;
}

export type OAuthGatewayEnvironment = Readonly<Record<string, unknown>>;

export function loadProvidersFromEnvironment(
	env: OAuthGatewayEnvironment,
): ResultType<readonly OAuthGatewayProvider[], OAuthGatewayConfigurationInvalid> {
	const raw = env.OAUTH_GATEWAY_PROVIDERS;
	if (typeof raw !== "string" || raw.trim().length === 0) {
		return Result.err(
			new OAuthGatewayConfigurationInvalid({
				message: "OAuth Gateway provider configuration is missing",
				data: { reason: "providers_missing" },
			}),
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		return Result.err(
			new OAuthGatewayConfigurationInvalid({
				message: "OAuth Gateway provider configuration is not valid JSON",
				data: { reason: "providers_json_invalid" },
				cause,
			}),
		);
	}
	if (!Array.isArray(parsed)) return invalidConfiguration("providers_not_array");
	const providers: OAuthGatewayProvider[] = [];
	const ids = new Set<string>();
	for (const item of parsed) {
		const definition = parseDefinition(item);
		if (!definition) return invalidConfiguration("provider_definition_invalid");
		if (ids.has(definition.id)) return invalidConfiguration("provider_id_duplicate", definition.id);
		const clientId = stringEnv(env, definition.clientIdEnv);
		const clientSecret = stringEnv(env, definition.clientSecretEnv);
		if (!clientId || !clientSecret) return invalidConfiguration("provider_secret_missing", definition.id);
		if (!isHttpsUrl(definition.authorizationEndpoint) || !isHttpsUrl(definition.tokenEndpoint)) {
			return invalidConfiguration("provider_endpoint_invalid", definition.id);
		}
		if (definition.revokeEndpoint !== undefined && !isHttpsUrl(definition.revokeEndpoint)) {
			return invalidConfiguration("provider_revoke_endpoint_invalid", definition.id);
		}
		if (!isHttpsUrl(definition.gatewayCallbackUrl) || !isApplicationCallbackUrl(definition.applicationCallbackUrl)) {
			return invalidConfiguration("callback_url_invalid", definition.id);
		}
		ids.add(definition.id);
		providers.push({
			id: definition.id,
			authorizationEndpoint: definition.authorizationEndpoint,
			tokenEndpoint: definition.tokenEndpoint,
			...(definition.revokeEndpoint === undefined ? {} : { revokeEndpoint: definition.revokeEndpoint }),
			clientId,
			clientSecret,
			gatewayCallbackUrl: definition.gatewayCallbackUrl,
			applicationCallbackUrl: definition.applicationCallbackUrl,
			scopes: definition.scopes,
			...(definition.authorizationParams ? { authorizationParams: definition.authorizationParams } : {}),
		});
	}
	return Result.ok(providers);

	function invalidConfiguration(reason: string, providerId?: string) {
		return Result.err(
			new OAuthGatewayConfigurationInvalid({
				message: "OAuth Gateway provider configuration is invalid",
				data: { reason, ...(providerId === undefined ? {} : { providerId }) },
			}),
		);
	}
}

function parseDefinition(value: unknown): ProviderEnvironmentDefinition | undefined {
	if (!isRecord(value)) return undefined;
	const id = readString(value.id);
	const authorizationEndpoint = readString(value.authorizationEndpoint);
	const tokenEndpoint = readString(value.tokenEndpoint);
	const clientIdEnv = readString(value.clientIdEnv);
	const clientSecretEnv = readString(value.clientSecretEnv);
	const gatewayCallbackUrl = readString(value.gatewayCallbackUrl);
	const applicationCallbackUrl = readString(value.applicationCallbackUrl);
	const scopes = value.scopes;
	const authorizationParams = value.authorizationParams;
	if (
		!id ||
		!authorizationEndpoint ||
		!tokenEndpoint ||
		!clientIdEnv ||
		!clientSecretEnv ||
		!gatewayCallbackUrl ||
		!applicationCallbackUrl ||
		!Array.isArray(scopes) ||
		scopes.some((scope) => typeof scope !== "string" || scope.length === 0)
	) {
		return undefined;
	}
	const revokeEndpoint = value.revokeEndpoint === undefined ? undefined : readString(value.revokeEndpoint);
	if (value.revokeEndpoint !== undefined && !revokeEndpoint) return undefined;
	if (authorizationParams !== undefined && !isStringRecord(authorizationParams)) return undefined;
	return {
		id,
		authorizationEndpoint,
		tokenEndpoint,
		...(revokeEndpoint === undefined ? {} : { revokeEndpoint }),
		clientIdEnv,
		clientSecretEnv,
		gatewayCallbackUrl,
		applicationCallbackUrl,
		scopes,
		...(authorizationParams === undefined ? {} : { authorizationParams }),
	};
}

function stringEnv(env: OAuthGatewayEnvironment, key: string): string | undefined {
	const value = env[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function isApplicationCallbackUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol === "jai:") return true;
		return (
			url.protocol === "http:" &&
			url.hostname === "127.0.0.1" &&
			url.port === "43821" &&
			url.pathname === "/v1/oauth/callback" &&
			url.search.length === 0 &&
			url.hash.length === 0
		);
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string" && item.length > 0);
}
