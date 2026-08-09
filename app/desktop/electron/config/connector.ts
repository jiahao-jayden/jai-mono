import type { CodingAgentSettings } from "@jai/coding/runtime";
import {
	type ConnectorOAuthProviderDefinition,
	type ConnectorOAuthProviderId,
	findConnectorOAuthProvider,
	listConnectorActionCatalog,
	type OAuthTokenResponse,
	parseConnectorOAuthScopes,
} from "@jai/connector";
import type {
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorCredential,
	DesktopConnectorPermission,
	DesktopConnectorProvider,
} from "../../shared/desktop-rpc";

export const connectorProviderDefinitions = [
	{
		id: "context7",
		name: "Context7",
		iconUrl: "https://context7.com/favicon.ico",
		description: "Up-to-date library documentation and code context for your agent.",
		authTypes: ["api_key"],
		credentials: [
			{
				key: "apiKey",
				label: "API key",
				kind: "secret",
				description: "Create an API key in your Context7 account.",
				placeholder: "Paste your Context7 API key",
			},
		],
	},
	{
		id: "amap",
		name: "AMap",
		iconUrl: "https://www.amap.com/favicon.ico",
		description: "Geocoding, places, weather, routing and geographic data.",
		authTypes: ["api_key"],
		credentials: [
			{
				key: "apiKey",
				label: "API key",
				kind: "secret",
				description: "Create a Web Service key in the AMap console.",
				placeholder: "Paste your AMap Web Service key",
			},
		],
	},
	{
		id: "mcdonalds_cn",
		name: "McDonald's China",
		iconUrl: "https://www.mcdonalds.com.cn/favicon.ico",
		description: "Store, menu and product lookup through the Open Platform APIs.",
		authTypes: ["custom_credential"],
		credentials: [
			{ key: "appId", label: "App ID", kind: "text", placeholder: "Your application ID" },
			{ key: "merchantId", label: "Merchant ID", kind: "text", placeholder: "Your merchant ID" },
			{ key: "signingKey", label: "Signing key", kind: "secret", placeholder: "Paste your signing key" },
			{
				key: "environment",
				label: "Environment",
				kind: "text",
				description: "Use prod for live data or uat for testing.",
				placeholder: "prod",
			},
		],
	},
	{
		id: "google",
		name: "Google",
		iconUrl: "https://www.google.com/favicon.ico",
		description: "One connection for Google Drive, Gmail, and Google Calendar.",
		authTypes: ["oauth"],
		credentials: [],
	},
	{
		id: "github",
		name: "GitHub",
		iconUrl: "https://github.com/favicon.ico",
		description: "Repositories, issues, pull requests, workflows, and your GitHub profile.",
		authTypes: ["oauth"],
		credentials: [],
	},
] as const;

const oauthCredentialKeys = ["accessToken", "refreshToken", "tokenType", "expiresAt", "scopes"] as const;

export type ConnectorOAuthToken = OAuthTokenResponse & {
	readonly expiresAt?: number;
	readonly scopes: readonly string[];
};

export function findDesktopConnectorOAuthProvider(providerId: string): ConnectorOAuthProviderDefinition | undefined {
	return findConnectorOAuthProvider(providerId);
}

export function projectConnectorConfig(
	settings: CodingAgentSettings["connector"] | undefined,
): DesktopConnectorConfigSnapshot {
	const providers = settings?.providers ?? {};
	const policy = settings?.policy;
	const defaultPermission: DesktopConnectorPermission = policy?.default ?? "ask";
	const actionPermissions = policy?.actions ?? {};
	const actionCatalog = listConnectorActionCatalog();
	return {
		providers: connectorProviderDefinitions.map((definition): DesktopConnectorProvider => {
			const provider = providers[definition.id];
			const credentials = provider?.credentials ?? {};
			const oauth = findConnectorOAuthProvider(definition.id);
			return {
				id: definition.id,
				name: definition.name,
				iconUrl: definition.iconUrl,
				description: definition.description,
				authTypes: definition.authTypes,
				enabled: provider?.enabled !== false,
				credentials: definition.credentials.map(
					(definitionCredential): DesktopConnectorCredential => ({
						...definitionCredential,
						configured:
							typeof credentials[definitionCredential.key] === "string" &&
							credentials[definitionCredential.key]!.length > 0,
						...(credentials[definitionCredential.key]
							? { mask: maskCredential(credentials[definitionCredential.key]!) }
							: {}),
					}),
				),
				actions: actionCatalog
					.filter((action) => action.providerId === definition.id)
					.map((action) => ({
						actionId: `${action.providerId}.${action.actionId}`,
						description: action.description,
						sideEffect: action.sideEffect,
						dataSensitivity: action.dataSensitivity,
						permission: actionPermissions[`${action.providerId}.${action.actionId}`] ?? defaultPermission,
					})),
				...(oauth
					? {
							oauth: projectOAuthConnection(credentials, oauth.scopes),
						}
					: {}),
			};
		}),
		policy: {
			default: defaultPermission,
			actions: { ...actionPermissions },
		},
	};
}

export function toStoredConnectorOAuthToken(
	providerId: ConnectorOAuthProviderId,
	token: OAuthTokenResponse,
	now = Date.now(),
): ConnectorOAuthToken {
	const provider = findConnectorOAuthProvider(providerId)!;
	const scopes = parseConnectorOAuthScopes(token.scope);
	return {
		accessToken: token.accessToken,
		tokenType: token.tokenType,
		...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
		...(token.expiresIn === undefined ? {} : { expiresAt: now + token.expiresIn * 1_000 }),
		scopes: scopes.length > 0 ? scopes : provider.scopes,
	};
}

export function storeConnectorOAuthToken(
	connector: CodingAgentSettings["connector"] | undefined,
	providerId: ConnectorOAuthProviderId,
	token: ConnectorOAuthToken,
): NonNullable<CodingAgentSettings["connector"]> {
	const providers = connector?.providers ?? {};
	const current = providers[providerId];
	const credentials = {
		...(current?.credentials ?? {}),
		accessToken: token.accessToken,
		tokenType: token.tokenType,
		scopes: token.scopes.join(" "),
		...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
		...(token.expiresAt === undefined ? {} : { expiresAt: String(token.expiresAt) }),
	};
	return {
		...(connector ?? {}),
		providers: {
			...providers,
			[providerId]: {
				...(current ?? {}),
				enabled: current?.enabled ?? true,
				credentials,
			},
		},
	};
}

export function removeConnectorOAuthToken(
	connector: CodingAgentSettings["connector"] | undefined,
	providerId: ConnectorOAuthProviderId,
): NonNullable<CodingAgentSettings["connector"]> {
	const providers = connector?.providers ?? {};
	const current = providers[providerId];
	const { credentials: _currentCredentials, ...currentWithoutCredentials } = current ?? {};
	const credentials = { ...(current?.credentials ?? {}) };
	for (const key of oauthCredentialKeys) delete credentials[key];
	return {
		...(connector ?? {}),
		providers: {
			...providers,
			[providerId]: {
				...currentWithoutCredentials,
				enabled: current?.enabled ?? true,
				...(Object.keys(credentials).length > 0 ? { credentials } : {}),
			},
		},
	};
}

export function toStoredConnector(
	input: DesktopConnectorConfigInput,
	current: CodingAgentSettings["connector"] | undefined,
): NonNullable<CodingAgentSettings["connector"]> {
	const currentProviders = current?.providers ?? {};
	const nextProviders = { ...currentProviders };
	for (const provider of input.providers) {
		const currentCredentials = currentProviders[provider.id]?.credentials ?? {};
		const credentials = { ...currentCredentials };
		for (const [key, value] of Object.entries(provider.credentials)) {
			const trimmed = value.trim();
			if (trimmed) credentials[key] = trimmed;
		}
		nextProviders[provider.id] = {
			...(currentProviders[provider.id] ?? {}),
			enabled: provider.enabled,
			...(Object.keys(credentials).length > 0 ? { credentials } : {}),
		};
	}
	return {
		...(current ?? {}),
		policy: {
			...(current?.policy ?? {}),
			default: input.policy.default,
			actions: { ...input.policy.actions },
		},
		providers: nextProviders,
	};
}

export function validateConnectorConfigInput(value: DesktopConnectorConfigInput | undefined): boolean {
	if (value === undefined) return true;
	if (!isRecord(value) || !Array.isArray(value.providers)) return false;
	if (!isValidConnectorPolicy(value.policy)) return false;
	const ids = new Set<string>();
	for (const provider of value.providers) {
		const definition = isRecord(provider)
			? connectorProviderDefinitions.find((candidate) => candidate.id === provider.id)
			: undefined;
		if (
			!isRecord(provider) ||
			typeof provider.id !== "string" ||
			!definition ||
			typeof provider.enabled !== "boolean" ||
			!isRecord(provider.credentials) ||
			Object.values(provider.credentials).some((credential) => typeof credential !== "string") ||
			Object.keys(provider.credentials).some(
				(key) => !definition.credentials.some((candidate) => candidate.key === key),
			)
		)
			return false;
		if (ids.has(provider.id)) return false;
		ids.add(provider.id);
	}
	return true;
}

function isValidConnectorPolicy(value: unknown): value is DesktopConnectorConfigInput["policy"] {
	if (!isRecord(value) || !isConnectorPermission(value.default) || !isRecord(value.actions)) return false;
	const actionIds = new Set(listConnectorActionCatalog().map((action) => `${action.providerId}.${action.actionId}`));
	return Object.entries(value.actions).every(
		([actionId, permission]) => actionIds.has(actionId) && isConnectorPermission(permission),
	);
}

function isConnectorPermission(value: unknown): value is DesktopConnectorPermission {
	return value === "allow" || value === "ask" || value === "deny";
}

function maskCredential(value: string): string {
	return `•••• ${value.slice(-4)}`;
}

function projectOAuthConnection(
	credentials: Readonly<Record<string, string>>,
	defaultScopes: readonly string[],
): NonNullable<DesktopConnectorProvider["oauth"]> {
	const accessToken = credentials.accessToken;
	const expiresAt = Number(credentials.expiresAt);
	const scopes = parseConnectorOAuthScopes(credentials.scopes);
	return {
		connected: Boolean(accessToken),
		scopes: scopes.length > 0 ? scopes : accessToken ? defaultScopes : [],
		...(Number.isFinite(expiresAt) && expiresAt > 0 ? { expiresAt } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
