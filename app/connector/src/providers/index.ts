import { findConnectorOAuthProvider, parseConnectorOAuthScopes } from "../oauth-providers";
import { MemoryConnectorService, type MemoryConnectorServiceOptions } from "../runtime";
import type { ActionDefinition, ConnectionRecord, ConnectorPolicy, ConnectorProviderSettings } from "../types";
import { type AMapAdapterOptions, createAMapAdapter } from "./amap";
import { type Context7AdapterOptions, createContext7Adapter } from "./context7";
import { createGitHubAdapter, type GitHubAdapterOptions } from "./github";
import { createGoogleAdapter, type GoogleAdapterOptions } from "./google";
import { createMcDonaldsCnAdapter, type McDonaldsCnAdapterOptions } from "./mcdonalds-cn";

export { type AMapAdapterOptions, createAMapAdapter } from "./amap";
export { type Context7AdapterOptions, createContext7Adapter } from "./context7";
export { createGitHubAdapter, type GitHubAdapterOptions } from "./github";
export { createGoogleAdapter, type GoogleAdapterOptions } from "./google";
export { createMcDonaldsCnAdapter, type McDonaldsCnAdapterOptions } from "./mcdonalds-cn";

export type ConnectorActionCatalogEntry = Pick<
	ActionDefinition,
	"providerId" | "actionId" | "description" | "sideEffect" | "dataSensitivity"
>;

export function listConnectorActionCatalog(): readonly ConnectorActionCatalogEntry[] {
	return [
		createContext7Adapter(),
		createAMapAdapter(),
		createMcDonaldsCnAdapter(),
		createGoogleAdapter(),
		createGitHubAdapter(),
	].flatMap((adapter) =>
		adapter.actions.map(({ providerId, actionId, description, sideEffect, dataSensitivity }) => ({
			providerId,
			actionId,
			description,
			sideEffect,
			dataSensitivity,
		})),
	);
}

export interface DefaultConnectorServiceOptions
	extends Context7AdapterOptions,
		AMapAdapterOptions,
		McDonaldsCnAdapterOptions,
		GitHubAdapterOptions,
		GoogleAdapterOptions {
	readonly context7ApiKey?: string;
	readonly amapApiKey?: string;
	readonly mcdonaldsCnCredential?: Readonly<{
		appId: string;
		merchantId: string;
		signingKey: string;
		environment?: string;
	}>;
	readonly policy?: ConnectorPolicy;
	readonly providers?: Readonly<Record<string, ConnectorProviderSettings>>;
}

export function createDefaultConnectorService(options: DefaultConnectorServiceOptions = {}): MemoryConnectorService {
	const context7Settings = options.providers?.context7;
	const amapSettings = options.providers?.amap;
	const mcdonaldsCnSettings = options.providers?.mcdonalds_cn;
	const googleSettings = options.providers?.google;
	const githubSettings = options.providers?.github;
	const context7ApiKey = options.context7ApiKey ?? context7Settings?.credentials?.apiKey;
	const amapApiKey = options.amapApiKey ?? amapSettings?.credentials?.apiKey;
	const mcdonaldsCnCredential =
		options.mcdonaldsCnCredential ?? readMcDonaldsCnCredentialFromSettings(mcdonaldsCnSettings);
	const context7Connected = Boolean(context7ApiKey);
	const amapConnected = Boolean(amapApiKey);
	const mcdonaldsCnConnected = Boolean(
		mcdonaldsCnCredential?.appId && mcdonaldsCnCredential.merchantId && mcdonaldsCnCredential.signingKey,
	);
	const googleConnection = readOAuthConnection("google", googleSettings);
	const githubConnection = readOAuthConnection("github", githubSettings);
	const credentials = {
		...(context7ApiKey ? { context7: { apiKey: context7ApiKey } } : {}),
		...(amapApiKey ? { amap: { apiKey: amapApiKey } } : {}),
		...(mcdonaldsCnCredential && mcdonaldsCnConnected ? { mcdonalds_cn: mcdonaldsCnCredential } : {}),
		...(googleConnection.credentials ? { google: googleConnection.credentials } : {}),
		...(githubConnection.credentials ? { github: githubConnection.credentials } : {}),
	};
	const connections: readonly ConnectionRecord[] = [
		{
			providerId: "context7",
			displayName: "Context7",
			status: context7Connected ? "connected" : "disconnected",
			scopes: context7Connected ? ["context7.library.search", "context7.context.read"] : [],
		},
		{
			providerId: "amap",
			displayName: "AMap",
			status: amapConnected ? "connected" : "disconnected",
			scopes: amapConnected ? ["amap.webservice.read"] : [],
		},
		{
			providerId: "mcdonalds_cn",
			displayName: "McDonald's China",
			status: mcdonaldsCnConnected ? "connected" : "disconnected",
			scopes: mcdonaldsCnConnected ? ["mcdonalds_cn.read"] : [],
		},
		{
			providerId: "google",
			displayName: "Google",
			status: googleConnection.status,
			scopes: googleConnection.scopes,
		},
		{
			providerId: "github",
			displayName: "GitHub",
			status: githubConnection.status,
			scopes: githubConnection.scopes,
		},
	];
	const serviceOptions: MemoryConnectorServiceOptions = {
		adapters: [
			createContext7Adapter(options),
			createAMapAdapter(options),
			createMcDonaldsCnAdapter(options),
			createGoogleAdapter(options),
			createGitHubAdapter(options),
		],
		connections,
		policy: {
			...options.policy,
			...(context7Settings?.enabled === false ||
			amapSettings?.enabled === false ||
			mcdonaldsCnSettings?.enabled === false ||
			googleSettings?.enabled === false ||
			githubSettings?.enabled === false
				? {
						disabledProviders: [
							...new Set([
								...(options.policy?.disabledProviders ?? []),
								...(context7Settings?.enabled === false ? ["context7"] : []),
								...(amapSettings?.enabled === false ? ["amap"] : []),
								...(mcdonaldsCnSettings?.enabled === false ? ["mcdonalds_cn"] : []),
								...(googleSettings?.enabled === false ? ["google"] : []),
								...(githubSettings?.enabled === false ? ["github"] : []),
							]),
						],
					}
				: {}),
		},
		...(Object.keys(credentials).length > 0 ? { credentials } : {}),
	};
	return new MemoryConnectorService(serviceOptions);
}

function readOAuthConnection(
	providerId: "google" | "github",
	settings: ConnectorProviderSettings | undefined,
): {
	readonly credentials?: Readonly<Record<string, string>>;
	readonly scopes: readonly string[];
	readonly status: ConnectionRecord["status"];
} {
	const credentials = settings?.credentials;
	const accessToken = credentials?.accessToken;
	if (!accessToken) return { status: "disconnected", scopes: [] };
	const expiresAt = Number(credentials.expiresAt);
	const configuredScopes = parseConnectorOAuthScopes(credentials.scopes);
	const defaultScopes = findConnectorOAuthProvider(providerId)?.scopes ?? [];
	return {
		credentials,
		scopes: configuredScopes.length > 0 ? configuredScopes : defaultScopes,
		status: Number.isFinite(expiresAt) && expiresAt <= Date.now() ? "expired" : "connected",
	};
}

function readMcDonaldsCnCredentialFromSettings(
	settings: ConnectorProviderSettings | undefined,
): DefaultConnectorServiceOptions["mcdonaldsCnCredential"] {
	const credentials = settings?.credentials;
	if (!credentials?.appId || !credentials.merchantId || !credentials.signingKey) return undefined;
	return {
		appId: credentials.appId,
		merchantId: credentials.merchantId,
		signingKey: credentials.signingKey,
		...(credentials.environment ? { environment: credentials.environment } : {}),
	};
}
